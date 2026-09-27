const prisma = require('./prisma');

const fmtNum = (n) => {
  const num = Number(n || 0);
  return Number.isNaN(num)
    ? '0'
    : num.toLocaleString('id-ID', { maximumFractionDigits: 4 });
};
const fmtRp = (n) =>
  'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const itemMatchConditions = (name) => {
  const n = String(name || '').trim();
  if (!n) return [];
  const norm = normalize(n);
  return [
    { description: { equals: n, mode: 'insensitive' } },
    { description: { contains: n, mode: 'insensitive' } },
    ...(norm ? [{ description: { contains: norm, mode: 'insensitive' } }] : []),
  ];
};

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

async function getAggregatesForItem({ itemName, projectId }) {
  const conditions = itemMatchConditions(itemName);
  if (!conditions.length) {
    return { akumulasiPoQty: 0, akumulasiReceived: 0, akumulasiPoHargaRata: 0 };
  }

  const where = {
    OR: conditions,
    purchaseOrder: projectId ? { projectId } : undefined,
  };

  const poItems = await prisma.purchaseOrderItem.findMany({
    where,
    select: { qty: true, receivedVolume: true, unitPrice: true },
  });

  const akumulasiPoQty = poItems.reduce((sum, it) => sum + Number(it.qty || 0), 0);
  const akumulasiReceived = poItems.reduce(
    (sum, it) => sum + Number(it.receivedVolume || 0),
    0,
  );

  const weighted = poItems.reduce(
    (acc, it) => {
      const qty = Number(it.qty || 0);
      const price = Number(it.unitPrice || 0);
      return {
        totalQty: acc.totalQty + qty,
        totalVal: acc.totalVal + qty * price,
      };
    },
    { totalQty: 0, totalVal: 0 },
  );

  const akumulasiPoHargaRata =
    weighted.totalQty > 0 ? weighted.totalVal / weighted.totalQty : 0;

  return { akumulasiPoQty, akumulasiReceived, akumulasiPoHargaRata };
}

const buildKetVolume = ({ itemName, unit, rapQty, akumulasiPoQty, akumulasiReceived }) => {
  const u = unit ? ` ${unit}` : '';
  const rapPart = `RAP ${fmtNum(rapQty)}${u}`;
  const poPart = `PO ${fmtNum(akumulasiPoQty)}${u}`;
  const recvPart = `Diterima ${fmtNum(akumulasiReceived)}${u}`;

  if (rapQty > 0) {
    const diffPo = akumulasiPoQty - rapQty;
    const diffRecv = akumulasiReceived - rapQty;

    const statusPo =
      diffPo > 0
        ? `PO Over +${fmtNum(diffPo)}${u}`
        : diffPo < 0
          ? `PO Under ${fmtNum(Math.abs(diffPo))}${u}`
          : 'PO Sesuai';

    const statusRecv =
      diffRecv > 0
        ? `Terima Over +${fmtNum(diffRecv)}${u}`
        : diffRecv < 0
          ? `Terima Under ${fmtNum(Math.abs(diffRecv))}${u}`
          : 'Terima Sesuai';

    return `${itemName}: ${rapPart} | ${poPart} | ${recvPart} | ${statusPo} | ${statusRecv}`;
  }

  return `${itemName}: ${poPart} | ${recvPart}`;
};

const buildKetHarga = ({ itemName, rapPrice, poPrice, poAvgPrice }) => {
  if (rapPrice > 0) {
    const diffNow = poPrice - rapPrice;
    const diffAvg = poAvgPrice - rapPrice;

    const statusNow =
      diffNow > 0
        ? `PO Over +${fmtRp(diffNow)}`
        : diffNow < 0
          ? `PO Under ${fmtRp(Math.abs(diffNow))}`
          : 'PO Sesuai';

    const statusAvg =
      diffAvg > 0
        ? `Rata2 PO Over +${fmtRp(diffAvg)}`
        : diffAvg < 0
          ? `Rata2 PO Under ${fmtRp(Math.abs(diffAvg))}`
          : 'Rata2 PO Sesuai';

    return `${itemName}: RAP ${fmtRp(rapPrice)} | PO ${fmtRp(poPrice)} | Rata2 PO ${fmtRp(poAvgPrice)} | ${statusNow} | ${statusAvg}`;
  }

  return `${itemName}: PO ${fmtRp(poPrice)} | Rata2 PO ${fmtRp(poAvgPrice)}`;
};

/**
 * Hitung keterangan over/under volume & harga untuk sebuah PO.
 * - Ket Volume: RAP vs akumulasi PO vs akumulasi barang diterima.
 * - Ket Harga: RAP vs harga item PO saat ini + rata-rata harga PO.
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

    const { rapQty, rapPrice } = await getRapForItem({
      materialRequestId: item.materialRequestId,
      description: item.description,
      indukPoId,
    });

    const { akumulasiPoQty, akumulasiReceived, akumulasiPoHargaRata } =
      await getAggregatesForItem({
        itemName,
        projectId,
      });

    ketVolParts.push(
      buildKetVolume({
        itemName,
        unit,
        rapQty,
        akumulasiPoQty,
        akumulasiReceived,
      }),
    );

    ketHargaParts.push(
      buildKetHarga({
        itemName,
        rapPrice,
        poPrice,
        poAvgPrice: akumulasiPoHargaRata || poPrice,
      }),
    );
  }

  return {
    ketVolume: ketVolParts.length ? ketVolParts.join(' | ') : '-',
    ketHarga: ketHargaParts.length ? ketHargaParts.join(' | ') : '-',
  };
}

/**
 * Helper untuk riwayat/permintaan habis pakai:
 * - Ket volume: RAP vs akumulasi PO vs akumulasi diterima + status over/under.
 * - Ket harga: RAP vs harga rata-rata PO.
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

  const { akumulasiPoQty, akumulasiReceived, akumulasiPoHargaRata } =
    await getAggregatesForItem({
      itemName,
      projectId,
    });

  const keteranganVolume = buildKetVolume({
    itemName,
    unit,
    rapQty,
    akumulasiPoQty,
    akumulasiReceived,
  }).replace(`${itemName}: `, '');

  let keteranganHarga = '-';
  if (rapPrice > 0 || akumulasiPoHargaRata > 0) {
    keteranganHarga = buildKetHarga({
      itemName,
      rapPrice,
      poPrice: akumulasiPoHargaRata,
      poAvgPrice: akumulasiPoHargaRata,
    }).replace(`${itemName}: `, '');
  }

  return {
    rapQty,
    rapPrice,
    rapSource,
    akumulasiQty: akumulasiPoQty,
    akumulasiReceived,
    keteranganVolume,
    keteranganHarga,
  };
}

module.exports = {
  getKeteranganVolumeHarga,
  getKeteranganForHabisPakai,
  getRapForItem,
};
