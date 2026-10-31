/* Ставит иконку на MatrixL.exe. Встроенная правка electron-builder отключена (signAndEditExecutable: false -
   она требует прав администратора при локальной сборке), поэтому иконка записывается отдельно через rcedit. */
const path = require('path');
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const mod = await import('rcedit');
  const rcedit = mod.rcedit || mod.default;
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  await rcedit(exe, { icon: path.join(context.packager.projectDir, 'build', 'icon.ico') });
};
