const xlsx = require('xlsx');
const path = require('path');

const filePath = "c:\\KERJAAN\\Project\\RAP & JO - Neuna Beute Cito SBY.xlsx";
const workbook = xlsx.readFile(filePath);

const sheetName = 'JO JULI';
if (workbook.SheetNames.includes(sheetName)) {
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, range: 0 }); 
  console.log(JSON.stringify(data.slice(0, 30), null, 2));
} else {
  console.log('Sheet JO JULI not found. Available sheets:', workbook.SheetNames);
}
