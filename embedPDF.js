#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Helper: escape parentheses and backslashes
function pdfLiteralString(s) {
  return `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

function makePdfWithAttachment(filePath, outPdf) {
  const filename = path.basename(filePath);
  const data = fs.readFileSync(filePath);
  const compressed = zlib.deflateSync(data);

  let objects = [];
  let namesList = [];
  let nextObjNum;

  if (fs.existsSync(outPdf)) {
    // Try to preserve objects
    const pdfBytes = fs.readFileSync(outPdf);
    const pdfText = pdfBytes.toString('binary');

    const objRegex = /(\d+ 0 obj[\s\S]*?endobj\n)/g;
    const existingObjects = [...pdfText.matchAll(objRegex)].map(m => m[1]);
    objects = existingObjects;

    const objNums = existingObjects.map(o => parseInt(o.match(/^(\d+)/)[1], 10));
    nextObjNum = Math.max(...objNums) + 1;

    const namesMatch = pdfText.match(/\/Names\s*\[\s*(.*?)\s*\d+ 0 R\s*\]/s);
    if (namesMatch) {
      namesList = namesMatch[1].trim().split(/\s+/);
    } else {
      namesList = [];
    }
    namesList.push(pdfLiteralString(filename));
  } else {
    // Create a fresh PDF structure
    const obj1 = `1 0 obj
<< /Type /Catalog /Names 2 0 R >>
endobj
`;
    objects.push(obj1);

    const obj2 = `2 0 obj
<< /EmbeddedFiles 3 0 R >>
endobj
`;
    objects.push(obj2);

    namesList = [pdfLiteralString(filename)];
    nextObjNum = 4;
  }

  const fileObjNum = nextObjNum;
  const streamObjNum = nextObjNum + 1;

  const objNames = `${fileObjNum} 0 obj
<< /Names [ ${namesList.join(' ')} ${streamObjNum} 0 R ] >>
endobj
`;
  objects.push(objNames);

  const objFilespec = `${streamObjNum} 0 obj
<< /Type /Filespec /F ${pdfLiteralString(filename)} /EF << /F ${streamObjNum + 1} 0 R >> >>
endobj
`;
  objects.push(objFilespec);

  const objEmbedded = Buffer.concat([
    Buffer.from(
      `${streamObjNum + 1} 0 obj
<< /Type /EmbeddedFile /Filter /FlateDecode /Length ${compressed.length} >>
stream
`,
      'binary'
    ),
    compressed,
    Buffer.from(`\nendstream\nendobj\n`, 'binary')
  ]);
  objects.push(objEmbedded.toString('binary'));

  // Build PDF
  let outBytes = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary');
  const offsets = [];

  for (const obj of objects) {
    offsets.push(outBytes.length);
    outBytes = Buffer.concat([outBytes, Buffer.from(obj, 'binary')]);
  }

  const xrefStart = outBytes.length;
  let xref = `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefStart}
%%EOF
`;

  outBytes = Buffer.concat([outBytes, Buffer.from(xref + trailer, 'binary')]);
  fs.writeFileSync(outPdf, outBytes);
  console.log(`Embedded '${filename}' into ${outPdf} (${data.length} bytes).`);
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error('Usage: node embed_file_into_pdf.js file_to_embed output.pdf');
    process.exit(1);
  }

  const src = args[0];
  const dst = args[1];

  if (!fs.existsSync(src)) {
    console.error('Embed file does not exist:', src);
    process.exit(2);
  }

  makePdfWithAttachment(src, dst);
}
