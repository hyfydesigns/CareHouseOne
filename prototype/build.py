# Builds the two Vercel prototype pages (full and Release 0) from carehouse-one-prototype.html.
# Usage: python prototype/build.py   then: cd prototype/deploy/<name> && vercel deploy --prod
import os, sys
root = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "test" else os.path.dirname(os.path.abspath(__file__))
test = "test" in sys.argv[1:]
src = open(os.path.join(root, 'carehouse-one-prototype.html'), encoding='utf-8').read()
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="robots" content="noindex">\n')
def build(r0):
    s = src
    assert s.count('<script>\n') == 1 and s.count('"use strict";') >= 1
    title = 'CareHouse One · Release 0 Prototype' if r0 else 'CareHouse One · Full Prototype'
    s = s.replace('<title>CareHouse One Prototype</title>', '<title>%s</title>' % title, 1)
    if r0:
        s = s.replace('<script>\n', '<script>window.CH1_R0=true</script>\n<script>\n', 1)
    if test:
        s = s.replace('"use strict";', '"use strict";\nwindow.__T=function(e){return eval(e)};', 1)
    return head + s
base = os.path.join(root, 'deploy-test' if test else 'deploy')
for name, r0 in (('carehouse-one-full', False), ('carehouse-one-release-0', True)) if not test else (('full', False), ('release0', True)):
    d = os.path.join(base, name)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(build(r0))
print('built', base)
