const fs = require('fs');
const TOKEN = fs.readFileSync('token.txt','utf8').trim();
const api = async (method, path, body) => {
  const r = await fetch('http://localhost:4000'+path, {
    method,
    headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+TOKEN },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  console.log(method, path, r.status, t.slice(0,500));
};
(async () => {
  await api('GET','/api/gl-bank/akun/master');
  await api('POST','/api/gl-bank/akun/master',{kodeAkun:'1101',namaAkun:'Kas Kecil',tipeAkun:'KAS'});
  await api('POST','/api/gl-bank/akun/master',{kodeAkun:'1102',namaAkun:'Bank BCA',tipeAkun:'BANK'});
  await api('GET','/api/gl-bank/akun/master');
})();
