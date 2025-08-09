cd ..
cp -r wa rollback_wa
cd rollback_wa
git restore ./
npm run build
mv build ../wa/rollback
cd ..
rm -rf rollback_wa
cd wa