import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const srcDir = path.resolve('src');

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(filePath));
    } else if (filePath.endsWith('.js')) {
      results.push(filePath);
    }
  });
  return results;
}

try {
  const files = getFiles(srcDir);
  console.log(`Checking syntax for ${files.length} JavaScript files...`);
  
  for (const file of files) {
    execSync(`node --check "${file}"`, { stdio: 'inherit' });
  }
  
  console.log('All files compiled cleanly!');
  process.exit(0);
} catch (err) {
  console.error('Syntax check failed:', err.message);
  process.exit(1);
}
