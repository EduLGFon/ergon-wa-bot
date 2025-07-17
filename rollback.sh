cd ..
cp -r wa rollback_wa
cd rollback_wa
git restore ./
npm run build
mv build ../wa/rollback