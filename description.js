// Conservative title cleanup: retain product identity; discard trailing sales copy.
function normalizeDescription(value) {
  // Clean each item independently so trailing copy cannot swallow the next item.
  return [...new Set(String(value || '').split(/\s*;\s*/).map(normalizeItemDescription).filter(Boolean))].join('; ');
}

function normalizeItemDescription(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  // Recognize product identity before removing specifications. A comma can
  // occur in a compatibility list before the product noun (screen protectors).
  const identities = [
    [/^(NEW'C)\b.*\biPhone 16,\s*iPhone 15\s+Screen Protector\b/i, "$1 iPhone 16 / iPhone 15 Screen Protector"],
    [/^(Mintreus)\b.*\b(?:Shirt|Shirts|Blouses)\b/i, "$1 Women's Short Sleeve Shirt"],
    [/^(WIHOLL)\b.*\bTank Tops\b/i, "$1 Women's Tank Top"],
    [/^(Vinfact Jelly)\b.*\bBras\b/i, "$1 Bras"],
    [/^(Kedera)\b.*\bFloral Embroidered\b.*\bJeans\b/i, "$1 Women's Floral Embroidered Jeans"],
    [/^(MEGNYA)\b.*\bSlides\b/i, "$1 Slides"],
    [/^(Allimy)\b.*\bPointelle\b.*\bTops\b/i, "$1 Women's Pointelle Tank Top"],
    [/^(Kistore)\b.*\bAurora Shirts\b/i, "$1 Women's Aurora Shirt"],
    [/^(Saodimallsu)\b.*\bSweaters\b/i, "$1 Women's Short Sleeve Sweater"],
    [/^(CHICME)\b.*\bChiffon\b.*\bCamisole\b/i, "$1 Women's Chiffon Camisole"],
    [/^(Zeagoo)\b.*\bSatin Tank Top\b/i, "$1 Women's Satin Tank Top"],
    [/^(Fisoew)\b.*\bCrochet Cover Up Tops\b/i, "$1 Women's Crochet Cover Up Top"],
    [/^Vintage Boho Flower\b.*\bTshirt\b/i, "Vintage Boho Flower Women's T-Shirt"],
    [/^Tank Tops for Women\b.*\bFloral\b/i, "Women's Floral Tank Top"],
    [/^(Toiletry Bag for Men)\b/i, "$1"],
    [/^(Reyroltay)\b.*\bHair Color Cape\b/i, "$1 Hair Color Cape"],
    [/^(SAKURA Pigma)\b.*\bMicron\b.*\bInk Pen Set\b/i, "$1 Micron Ink Pen Set"],
    [/^(Simpli-Magic Canvas Tote Bag)\b/i, "$1"],
    [/^(Bodyprox Elbow Brace)\b/i, "$1"],
    [/^(Hion Nausea Relief Inhaler)\b/i, "$1"],
    [/^(Hionfurt)\b.*\bMotion Sickness Patches\b/i, "$1 Motion Sickness Patches"],
    [/^(GWXGWX Mesh Shower Caddy)\b/i, "$1"],
    [/^(Binbata Laundry Detergent Sheets)\b/i, "$1"],
    [/^(MEDLOT Hydrocolloid Roll)\b/i, "$1"],
    [/^(Reveal (?:Fish|Chicken) Variety)(?: Pack| in Broth)?\s+Wet Cat Food\b/i, "$1 Wet Cat Food"],
    [/^(Maison Perrier(?: Ultimate)? Sparkling Water)\b/i, "$1"],
    [/^(Sculpey Premo)\b.*\bPolymer Oven Bake Clay\b/i, "$1 Polymer Oven Bake Clay"],
    [/^(Magnesium)\b.*\bSupplement\b/i, "$1 Supplement"],
    [/^(Barossa Design)\b.*\bStall Shower Curtain Liner\b/i, "$1 Stall Shower Curtain Liner"],
    [/^(Rhino USA Lashing Straps)\b/i, "$1"],
    [/^(Citric Acid)\b/i, "$1"],
    [/^(TUMAX)\b.*\bCam Buckle Lashing Straps\b/i, "$1 Cam Buckle Lashing Straps"],
    [/^12V\/24V DC Power Cord\b.*\bCar Refrigerator\b/i, "Car Refrigerator DC Power Cord"],
    [/^(Holikme)\b.*\bDrill Brush\b/i, "$1 Drill Brush Set"],
    [/^(Cottonelle Ultra Clean Toilet Paper)\b/i, "$1"],
    [/^(Arifoglu SUMAC Sauce)\b/i, "$1"],
    [/^(Frank Mully Women's Ballet Flat Shoes)\b/i, "$1"],
    [/^(Temptations Cat Treats)\b/i, "$1"],
    [/^(Pure Bali Hair Vitamins Moroccan Oil Capsules)\b/i, "$1"],
    [/^(FresKaro)\b.*\bClimbing Carabiners\b/i, "$1 Climbing Carabiners"],
    [/^(medicube Capsule Cream)\b/i, "$1"],
    [/^(Otlonpe Handheld Misting Fan)\b/i, "$1"],
    [/^(SABRENT USB 3\.0 to SATA)\b.*\bDual Bay External Hard Drive Docking Station\b/i, "$1 Dual Bay Hard Drive Docking Station"],
    [/^(Fitpolo Smart Watch)\b/i, "$1"],
    [/^(WOCCI)\b.*\bSilicone Watch Band\b/i, "$1 Silicone Watch Band"],
    [/^(SR626SW Watch Batteries)\b/i, "$1"],
    [/^(FEATOL Wrist Brace)\b/i, "$1"],
    [/^(SGBETTER)\b.*\bPlastic Cowboy Hats\b/i, "$1 Plastic Cowboy Hats"],
    [/^(uxcell)\b.*\bCar Fender Fir Tree Clips\b/i, "$1 Car Fender Fir Tree Clips"],
    [/^(CAMBIVO Pilates Mat)\b/i, "$1"],
    [/^(VLOMOT)\b.*\bMulberry Silk Hair Scrunchies\b/i, "$1 Mulberry Silk Hair Scrunchies"],
    [/^(ESCULTORA)\b.*\bTaekwondo Kick Pads\b/i, "$1 Taekwondo Kick Pads"],
    [/^(EXQ Home Fluffy Comforter Set)\b/i, "$1"],
    [/^(MICORAL)\b.*\bBed Sheets Set\b/i, "$1 Bed Sheets Set"]
  ];
  for (const [pattern, replacement] of identities) {
    const match = title.match(pattern);
    if (match) return replacement.replace(/\$(\d+)/g, (_, index) => match[Number(index)] || '');
  }
  const kohler = title.match(/^KOHLER\s+(?:\d+[A-Z]*-\d+\s+)?(Brevia)\b.*\bToilet Seat\b/i);
  if (kohler) return `Kohler ${kohler[1][0].toUpperCase() + kohler[1].slice(1).toLowerCase()} Toilet Seat`;
  const watch = title.match(/^(Timex Expedition)\b.*\bWatch\b/i);
  if (watch) return `${watch[1]} Watch`;
  const camera = title.match(/^(KODAK PIXPRO FZ45)\b.*\bCamera\b/i);
  if (camera) return `${camera[1]} Camera`;
  if (/^Homedics\b.*\bPercussion Massager\b/i.test(title)) return 'Homedics Percussion Massager';
  // Commas inside a book title's parentheses are not specification separators.
  let depth = 0;
  let end = title.length;
  for (let i = 0; i < title.length; i++) {
    if (title[i] === '(') depth++;
    else if (title[i] === ')') depth = Math.max(0, depth - 1);
    else if (title[i] === ',' && depth === 0) { end = i; break; }
  }
  return title.slice(0, end).split(/\s*\|\s*/)[0]
    .replace(/\s+[-–—]\s+.*$/, '')
    .replace(/:\s+.*$/, '')
    .replace(/\s*\[Download\]\s*$/i, '')
    .trim();
}
