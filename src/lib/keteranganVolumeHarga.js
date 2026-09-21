const prisma = require('./prisma');

const fmtNum = (n) => {
  const num = Number(n || 0);
  return isNaN(num) ? '0' : num.toLocaleString('id-ID', { maximumFractionDigits: 4 });
};
const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Cari RAP qty & harga untuk sebuah item PO.
 * Prioritas 1: MaterialRequestItem (jika materialRequestId ada).
 * Prioritas 2: PO induk (jika poId induk ada dan item name cocok).
 * Prioritas 3: tidak ada -> rapQty=0, rapPrice=0.
 */
async function getRapForItem({ materialRequestId, description, indukPoId }) {
  let rapQty = 0;
  let rapPrice = 0;
  let rapSource = null;

  // Prioritas 1: MaterialRequestItem
  if (materialRequestId) {
    const mr = await prisma.materialRequestItem.findUnique({
      where: { id: materialRequestId },
      select: { estimatedVolume: true, pricePerUnit: true },
    });
    if (mr) {
      rapQty = Number(mr.estimatedVolume || 0);
      rapPrice = Number(mr.pricePerUnit || 0);
      rapSource = 'MR';
    }
  }

  // Prioritas 2: PO induk
  if ((rapQty <= 0 || rapPrice <= 0) && indukPoId) {
    const poItems = await prisma.purchaseOrderItem.findMany({
      where: { poId: indukPoId },
      select: { description: true, qty: true, unitPrice: true },
    });
    const itemNameNorm = normalize(description);
    const matching = poItems.find((it) => normalize(it.description) === itemNameNorm);
    if (matching) {
      if (rapQty <= 0) rapQty = Number(matching.qty || 0);
      if (rapPrice <= 0) rapPrice = Number(matching.unitPrice || 0);
      rapSource = rapSource || 'PO';
    }
  }

  return { rapQty, rapPrice, rapSource };
}

/**
 * Hitung keterangan over/under volume & harga untuk sebuah PO.
 * - Ket Volume: akumulasi qty PO (semua PO untuk itemName sama dalam project) vs RAP qty.
 * - Ket Harga: harga satuan item PO vs harga satuan RAP.
 */
async function getKeteranganVolumeHarga(po) {
  if (!po?.items?.length) return { ketVolume: '-', ketHarga: '-' };

  const ketVolParts = [];
  const ketHargaParts = [];

  // PO induk dari relasi permintaan habis pakai atau field po.poId
  let indukPoId = po.poId;
  if (!indukPoId && po.permintaanHabisPakai?.length) {
    indukPoId = po.permintaanHabisPakai[0].poId;
  }

  for (const item of po.items) {
    const itemName = item.description || 'Item';
    const unit = item.unit || '';
    const projectId = po.projectId;
    const poPrice = Number(item.unitPrice || 0);
    const poQty = Number(item.qty || 0);

    const { rapQty, rapPrice } = await getRapForItem({
      materialRequestId: item.materialRequestId,
      description: item.description,
      indukPoId,
    });

    // Akumulasi qty dari semua PO untuk item ini dalam project
    let akumulasiQty = poQty;
    if (itemName) {
      const allItems = await prisma.purchaseOrderItem.findMany({
        where: {
          description: { contains: itemName.trim(), mode: "insensitive" },
          purchaseOrder: projectId ? { projectId } : undefined,
        },
        select: { qty: true, poId: true },
      });
      akumulasiQty = allItems.reduce((s, it) => s + Number(it.qty || 0), 0);
      const alreadyCounted = allItems.some((it) => it.poId === po.id);
      if (!alreadyCounted) akumulasiQty += poQty;
    }

    // Volume
    if (rapQty > 0) {
      const diff = akumulasiQty - rapQty;
      if (diff > 0) ketVolParts.push(`${itemName}: Over ${fmtNum(diff)} ${unit} (RAP ${fmtNum(rapQty)})`);
      else if (diff < 0) ketVolParts.push(`${itemName}: Under ${fmtNum(Math.abs(diff))} ${unit} (RAP ${fmtNum(rapQty)})`);
      else ketVolParts.push(`${itemName}: Sesuai RAP ${fmtNum(rapQty)} ${unit}`);
    } else if (akumulasiQty > 0) {
      ketVolParts.push(`${itemName}: Akumulasi ${fmtNum(akumulasiQty)} ${unit}`);
    } else {
      ketVolParts.push(`${itemName}: -`);
    }

    // Harga
    if (rapPrice > 0) {
      const diff = poPrice - rapPrice;
      if (diff > 0) ketHargaParts.push(`${itemName}: Over ${fmtRp(diff)} (RAP ${fmtRp(rapPrice)})`);
      else if (diff < 0) ketHargaParts.push(`${itemName}: Under ${fmtRp(Math.abs(diff))} (RAP ${fmtRp(rapPrice)})`);
      else ketHargaParts.push(`${itemName}: Sesuai RAP ${fmtRp(rapPrice)}`);
    } else if (poPrice > 0) {
      ketHargaParts.push(`${itemName}: PO ${fmtRp(poPrice)}`);
    } else {
      ketHargaParts.push(`${itemName}: -`);
    }
  }

  return {
    ketVolume: ketVolParts.length ? ketVolParts.join(' | ') : '-',
    ketHarga: ketHargaParts.length ? ketHargaParts.join(' | ') : '-',
  };
}

/**
 * Helper untuk riwayat/permintaan habis pakai: menghasilkan keterangan singkat
 * berdasarkan RAP qty/harga dan akumulasi qty PO + permintaan.
 */
async function getKeteranganForHabisPakai({
  itemName,
  unit,
  mrItemId,
  indukPoId,
  projectId,
}) {
  const { rapQty, rapPrice, rapSource } = await getRapForItem({
    materialRequestId: mrItemId,
    description: itemName,
    indukPoId,
  });

  const itemNameTrim = (itemName || '').trim();

  // Akumulasi PO
  const poItemWhere = {
    description: { contains: itemNameTrim, mode: "insensitive" },
  };
  if (projectId) poItemWhere.purchaseOrder = { projectId };
  const poItems = await prisma.purchaseOrderItem.findMany({
    where: poItemWhere,
    select: { qty: true, receivedVolume: true, unitPrice: true },
  });
  const akumulasiQtyPo = poItems.reduce((sum, it) => sum + Number(it.qty || 0), 0);

  // Jumlahkan permintaan habis pakai yang belum jadi PO
  const permintaanWhere = {
    itemName: { contains: itemNameTrim, mode: "insensitive" },
    status: { not: "REJECTED" },
  };
  if (projectId) permintaanWhere.projectId = projectId;
  const permintaanItems = await prisma.permintaanHabisPakai.findMany({
    where: permintaanWhere,
    select: { qty: true },
  });
  const akumulasiQtyPermintaan = permintaanItems.reduce((sum, it) => sum + Number(it.qty || 0), 0);
  const akumulasiQty = akumulasiQtyPo + akumulasiQtyPermintaan;

  // Volume
  let keteranganVolume;
  if (rapQty > 0) {
    const diff = akumulasiQty - rapQty;
    const u = unit ? ` ${unit}` : '';
    if (diff > 0) keteranganVolume = `Over ${fmtNum(diff)}${u} (RAP ${fmtNum(rapQty)})`;
    else if (diff < 0) keteranganVolume = `Under ${fmtNum(Math.abs(diff))}${u} (RAP ${fmtNum(rapQty)})`;
    else keteranganVolume = `Sesuai RAP ${fmtNum(rapQty)}${u}`;
  } else if (akumulasiQty > 0) {
    keteranganVolume = `Akumulasi ${fmtNum(akumulasiQty)} ${unit}`;
  } else {
    keteranganVolume = '-';
  }

  // Permintaan belum punya harga PO, jadi Ket Harga selalu '-' atau info RAP saja
  let keteranganHarga = '-';
  if (rapPrice > 0) {
    keteranganHarga = `RAP ${fmtRp(rapPrice)}`;
  }

  return { rapQty, rapPrice, rapSource, akumulasiQty, keteranganVolume, keteranganHarga };
}

module.exports = {
  getKeteranganVolumeHarga,
  getKeteranganForHabisPakai,
  getRapForItem,
};
