import { compressText } from './middleware/compress.mjs';

const data = '[{"id":1,"region":"APAC","amount":5000},{"id":2,"region":"EMEA","amount":5100},{"id":3,"region":"NA","amount":5200}]';
const result = compressText(data);
const compressed = result.text;

console.log('Test 1: Small payload (3 records)');
console.log('Uncompressed JSON:', data.length, 'chars');
console.log('Compressed @T1 new format:', compressed.length, 'chars');
console.log('Saved:', ((1 - compressed.length / data.length) * 100).toFixed(1) + '%');
console.log('Compressed format:');
console.log(compressed);
