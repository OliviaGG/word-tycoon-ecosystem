import sys

path = '/opt/searchle/client/index.html'
with open(path, 'r') as f:
    content = f.read()

# 1. Change RELAY_URL to use same origin (no port, no http://)
old_relay = "var RELAY_URL = 'http://' + location.hostname + ':3000';"
new_relay = "var RELAY_URL = location.origin;"
if old_relay not in content:
    print('ERROR: Could not find old RELAY_URL')
    sys.exit(1)
content = content.replace(old_relay, new_relay)
print('RELAY_URL changed to location.origin')

# 2. Change /me link to use relative path
old_me = "meLink.href = 'http://' + location.hostname + ':3000/me';"
new_me = "meLink.href = '/me';"
if old_me not in content:
    print('ERROR: Could not find old meLink.href')
    sys.exit(1)
content = content.replace(old_me, new_me)
print('meLink.href changed to /me')

with open(path, 'w') as f:
    f.write(content)
print('Done')
