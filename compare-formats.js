import { compressText } from './middleware/compress.mjs';

const data = '[{"id":1,"region":"APAC","amount":5000},{"id":2,"region":"EMEA","amount":5100},{"id":3,"region":"NA","amount":5200}]';

// Option 1: Tabs + pipes (compact)
const option1 = `@T1|i|s|i
1	APAC	5000
2	EMEA	5100
3	NA	5200`;

// Option 2: English types (natural)
const option2 = `@T1 int string int
1	APAC	5000
2	EMEA	5100
3	NA	5200`;

// Option 3: Markdown-style (visual)
const option3 = `| id:i | region:s | amount:i |
| 1 | APAC | 5000 |
| 2 | EMEA | 5100 |
| 3 | NA | 5200 |`;

// Option 4: Current @T1 (baseline)
const option4 = `@T1(id:i,region:s,amount:i)
1,"APAC",5000
2,"EMEA",5100
3,"NA",5200`;

console.log('ORIGINAL JSON:', data.length, 'chars\n');

console.log('Option 1 - Tabs + pipes:');
console.log(option1);
console.log('Length:', option1.length, 'chars\n');

console.log('Option 2 - English types:');
console.log(option2);
console.log('Length:', option2.length, 'chars\n');

console.log('Option 3 - Markdown style:');
console.log(option3);
console.log('Length:', option3.length, 'chars\n');

console.log('Option 4 - Current @T1 (baseline):');
console.log(option4);
console.log('Length:', option4.length, 'chars\n');

// Save for testing
import fs from 'fs';
fs.writeFileSync('test-options.json', JSON.stringify({
  original: data,
  option1, option2, option3, option4
}, null, 2));
