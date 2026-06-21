import { compressText } from './middleware/compress.mjs';

const data = '[{"id":1,"region":"APAC","amount":5000},{"id":2,"region":"EMEA","amount":5100},{"id":3,"region":"NA","amount":5200}]';

// Current @T1 format
const result = compressText(data);
const t1Format = result.text;

// Alternative 1: CSV with header comment
const csvFormat = `# id,region,amount
1,APAC,5000
2,EMEA,5100
3,NA,5200`;

// Alternative 2: Compact JSONL with short keys
const jsonlFormat = `{"i":1,"r":"APAC","a":5000}
{"i":2,"r":"EMEA","a":5100}
{"i":3,"r":"NA","a":5200}`;

// Alternative 3: TSV (tab-separated)
const tsvFormat = `id\tregion\tamount
1\tAPAC\t5000
2\tEMEA\t5100
3\tNA\t5200`;

// Alternative 4: Plain pipes (very simple)
const pipeFormat = `id|region|amount
1|APAC|5000
2|EMEA|5100
3|NA|5200`;

console.log('Original JSON:', data.length, 'chars\n');
console.log('@T1 format:', t1Format.length, 'chars');
console.log(t1Format);
console.log('\nCSV format:', csvFormat.length, 'chars');
console.log(csvFormat);
console.log('\nJSONL format:', jsonlFormat.length, 'chars');
console.log(jsonlFormat);
console.log('\nTSV format:', tsvFormat.length, 'chars');
console.log(tsvFormat);
console.log('\nPipe format:', pipeFormat.length, 'chars');
console.log(pipeFormat);
