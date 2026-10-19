"""開發用：實際抓一輪候選資料來源，把原始回應存到 probe-results 分支供檢查。"""
import datetime as dt
import json
import pathlib
import platform
import time

import requests

from . import gitstate

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/129.0 Safari/537.36')
MAX_BODY = 400_000


def _decode(raw: bytes) -> str:
    for enc in ('utf-8-sig', 'cp950', 'big5hkscs'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def run():
    targets = json.loads((ROOT / 'control' / 'probe.json').read_text(encoding='utf-8'))
    out = gitstate.open_branch('probe-results', '.probe')
    for p in list(out.iterdir()):
        if p.name != '.git':
            if p.is_dir():
                import shutil
                shutil.rmtree(p)
            else:
                p.unlink()
    (out / 'raw').mkdir(exist_ok=True)

    session = requests.Session()
    session.headers.update({'User-Agent': UA, 'Accept': '*/*',
                            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.6'})
    summary = {'started': dt.datetime.utcnow().isoformat() + 'Z',
               'python': platform.python_version(), 'results': []}

    for t in targets:
        name = t['name']
        meta = {'name': name, 'url': t['url']}
        t0 = time.time()
        for verify in (True, False):
            try:
                if t.get('warmup'):
                    session.get(t['warmup'], timeout=20, verify=verify)
                r = session.request(t.get('method', 'GET'), t['url'], data=t.get('data'),
                                    json=t.get('json'), headers=t.get('headers'),
                                    timeout=t.get('timeout', 45), verify=verify)
                raw = r.content
                meta.update(status=r.status_code, final_url=r.url, size=len(raw),
                            content_type=r.headers.get('content-type'),
                            headers={k: v for k, v in r.headers.items()
                                     if k.lower() in ('content-type', 'cache-control', 'last-modified',
                                                      'date', 'server', 'set-cookie', 'location',
                                                      'access-control-allow-origin')},
                            verify=verify)
                (out / 'raw' / f'{name}.txt').write_text(_decode(raw[:MAX_BODY]), encoding='utf-8')
                break
            except requests.exceptions.SSLError as e:
                meta['ssl_error'] = repr(e)[:500]
                continue
            except Exception as e:  # noqa: BLE001 — 開發探測，記錄所有錯誤
                meta['error'] = repr(e)[:500]
                break
        meta['elapsed'] = round(time.time() - t0, 2)
        summary['results'].append(meta)
        print(json.dumps(meta, ensure_ascii=False)[:400], flush=True)
        time.sleep(t.get('sleep', 2.5))

    summary['finished'] = dt.datetime.utcnow().isoformat() + 'Z'
    (out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1),
                                      encoding='utf-8')
    gitstate.save_branch('probe-results', '.probe', 'probe ' + summary['finished'])
