# Smoke Test Manual — PO Jasa → Approve → Pengajuan → Verify Finance → Approve Atasan → Bayar BON → LUNAS

Base URL default: `http://localhost:4000`. Semua endpoint di-prefix `/api`.

Set token setelah login:
```bash
export BASE=http://localhost:4000
export TOKEN=<token-dari-login>
```

## 0. Login
```bash
curl -s $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<PASSWORD>"}'
```
Simpan `token` yang dikembalikan.

## 1. Approve PO Jasa
```bash
curl -s -X PUT $BASE/api/purchasing/po/<PO_ID>/approve \
  -H "Authorization: Bearer $TOKEN"
# expect: status 200, data.status = "APPROVED"
```

## 2. Buat Pengajuan Bayar
```bash
curl -s -X POST $BASE/api/purchasing/pengajuan-bayar \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "poId": "<PO_ID>",
    "projectId": "<PROJECT_ID>",
    "jasaId": "<JASA_ID>",
    "tanggal": "2026-10-03T00:00:00.000Z",
    "totalTagihan": 10000000,
    "catatan": "Pengajuan jasa X"
  }'
# expect: status 200, data.status = "PENDING", data.noPengajuan terisi
```

## 3. (Guard) Atasan belum boleh approve
```bash
curl -s -X PUT $BASE/api/purchasing/pengajuan-bayar/<PENGAJUAN_ID>/approve \
  -H "Authorization: Bearer $TOKEN"
# expect: 400 { error: "Pengajuan belum diverifikasi Finance..." }
```

## 4. Finance Verify
```bash
curl -s -X PUT $BASE/api/purchasing/pengajuan-bayar/<PENGAJUAN_ID>/verify \
  -H "Authorization: Bearer $TOKEN"
# expect: 200, data.status = "APPROVED_FINANCE", verifiedAt terisi
```

## 5. Atasan Approve
```bash
curl -s -X PUT $BASE/api/purchasing/pengajuan-bayar/<PENGAJUAN_ID>/approve \
  -H "Authorization: Bearer $TOKEN"
# expect: 200, data.status = "APPROVED"
# side-effect: PO berubah ke APPROVED (jika belum), draft pembayaran dibuat
```

## 6. Ambil draft pembayaran yang auto-generated
```bash
curl -s "$BASE/api/purchasing/pembayaran-supplier?poId=<PO_ID>" \
  -H "Authorization: Bearer $TOKEN"
# expect: list min 1 item, status = BELUM_BAYAR (jasa) atau PENDING (material)
```

## 7. Bayar BON (parsial)
```bash
curl -s -X PUT $BASE/api/purchasing/pembayaran-supplier/<PAYMENT_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "jumlahBayar": 5000000,
    "tanggal": "2026-10-03T00:00:00.000Z",
    "metodeBayar": "TRANSFER",
    "keterangan": "Bayar BON"
  }'
# expect: 200, data.status = "BON" (jasa) atau "PARTIAL" (material)
# data.sisaBayar > 0, data.noPembayaran mulai ter-generate di aksi/update
```

## 8. Bayar LUNAS
```bash
curl -s -X PUT $BASE/api/purchasing/pembayaran-supplier/<PAYMENT_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "jumlahBayar": 5000000,
    "tanggal": "2026-10-03T00:00:00.000Z",
    "metodeBayar": "TRANSFER",
    "keterangan": "Pelunasan"
  }'
# expect: 200, data.status = "LUNAS" (jasa) atau "PAID" (material)
# data.sisaBayar = 0
# side-effect: tercatat ke buku besar kas/bank
```

## 9. Jalankan versi otomatis
```bash
node scripts/smoke-po-jasa.js \
  --base http://localhost:4000 \
  --user admin --pass <PASSWORD>
```
Expected output akhir: `RESULT: ALL PASS ✅`.
