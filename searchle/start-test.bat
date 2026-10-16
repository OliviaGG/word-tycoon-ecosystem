@echo off
cd /d "C:\Searchle 3.0"
set PORT=3115
set DATA_DIR=C:\Searchle 3.0\data-test
echo [TEST] Starting Searchle 3.0 test server on port %PORT%
echo [TEST] Data dir: %DATA_DIR%
node server/server.js
