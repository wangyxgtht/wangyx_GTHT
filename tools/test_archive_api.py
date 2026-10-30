# -*- coding: utf-8 -*-
"""接口自测：py -3 tools/test_archive_api.py [端口]"""
import base64
import json
import sys
import urllib.parse
import urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
BASE = 'http://127.0.0.1:%d' % PORT


def call(path, payload=None):
    url = BASE + path
    if payload is None:
        req = urllib.request.Request(url)
    else:
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8'))


raw = open(r'samples\sample_宽表.xlsx', 'rb').read()
res = call('/api/archive', {
    'fileName': 'sample_宽表.xlsx',
    'kind': 'product',
    'fileB64': base64.b64encode(raw).decode('ascii'),
    'snapshot': '# 测试快照\n\n- 年化：10.00%\n',
    'meta': {'product': '稳健配置一号', 'range': '2021-01-08 ~ 2025-08-08', 'annualized': '10.00%', 'maxDD': '-4.89%'},
})
print('archive:', res)

print('list:', call('/api/list')['items'][:4])
name = [x for x in res['saved'] if x.endswith('.md')][0]
q = urllib.parse.quote(name)
print('text:', call('/api/text?name=' + q)['text'][:20].replace('\n', ' '))
print('file bytes:', len(urllib.request.urlopen(BASE + '/api/file?name=' + q, timeout=20).read()))
print('delete:', call('/api/delete', {'name': name}))
