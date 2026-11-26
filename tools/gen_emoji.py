#!/usr/bin/env python3
"""Bundle a folder of emoji SVGs (e.g. Blobmoji: emoji_u1f60a.svg or "hut.svg") into src/emoji/blob.js.
Usage: python3 tools/gen_emoji.py "path/to/blob emoji" [out.js]"""
import json, os, re, sys, unicodedata

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'src', 'emoji', 'blob.js')
TONES = {0x1F3FB: 'light skin tone', 0x1F3FC: 'medium-light skin tone', 0x1F3FD: 'medium skin tone',
         0x1F3FE: 'medium-dark skin tone', 0x1F3FF: 'dark skin tone'}

def cp_name(cp):
    if cp in TONES: return TONES[cp]
    if cp == 0x200D: return None
    if cp in (0xFE0F, 0xFE0E): return None
    try: return unicodedata.name(chr(cp)).lower()
    except ValueError: return 'u+%x' % cp

def clean(svg):
    svg = re.sub(r'<\?xml[^>]*\?>', '', svg)
    svg = re.sub(r'<!DOCTYPE[^>]*>', '', svg)
    svg = re.sub(r'<!--.*?-->', '', svg, flags=re.S)
    svg = re.sub(r'>\s+<', '><', svg).strip()
    return svg

items = []
for fn in sorted(os.listdir(src)):
    if not fn.lower().endswith('.svg'): continue
    base = fn[:-4]
    text = clean(open(os.path.join(src, fn), encoding='utf-8').read())
    m = re.fullmatch(r'emoji_u([0-9a-f_]+)', base)
    if m:
        cps = [int(x, 16) for x in m.group(1).split('_')]
        parts = [cp_name(c) for c in cps]
        name = ' '.join(p for p in parts if p)
        char = ''.join(chr(c) for c in cps)
        ident = 'u' + m.group(1).replace('_', '-')
    else:
        name = base
        char = ''
        ident = re.sub(r'[^a-z0-9]+', '-', base.lower()).strip('-')
    items.append({'i': ident, 'n': name, 'c': char, 's': text})

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    f.write('/* Blobmoji (Apache-2.0, Google Noto Emoji / C1710 Blobmoji), bundled by tools/gen_emoji.py */\n')
    f.write('window.BLOB_EMOJI=' + json.dumps(items, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(items), 'emoji ->', out, os.path.getsize(out) // 1024, 'KB')
