const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('description.js', 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(`${source}\nthis.normalizeDescription = normalizeDescription;`, context);

const cases = [
  [
    'YZAESHAY Replacement 65W USB C Laptop Charger Compatible with HP Chromebook and All 65W USB Type C Power Adapter',
    'YZAESHAY 65W USB C Laptop Charger'
  ],
  [
    'PROZOR 192KHz Digital to Analog Audio Converter DAC Digital Optical to RCA Analog L/R Converter',
    'PROZOR Digital to Analog Audio Converter'
  ],
  [
    'InnoStars 12AWG Speaker Cable Wire with 24K Dual Gold-Plated Banana Tip Plugs (6 Feet) in-Wall CL2 Rated',
    'InnoStars 12AWG Speaker Cable'
  ],
  [
    'AirGearPro G-500 Reusable Respirator Mask with A1P2 Vapor & Dust Filters',
    'AirGearPro G-500 Reusable Respirator Mask'
  ],
  [
    'Kitsch XL Microfiber Hair Towel Wrap for Women',
    'Kitsch XL Microfiber Hair Towel Wrap'
  ],
  [
    'TOTOÂ® SoftCloseÂ® Slow Close Elongated Toilet Seat and Lid',
    'TOTO SoftClose Elongated Toilet Seat and Lid'
  ],
  [
    'Amazon Basics 3-Blade Razor Refills for Men with Dual Lubrication',
    'Amazon Basics 3-Blade Razor Refills'
  ]
];

let failures = 0;
for (const [input, expected] of cases) {
  const actual = context.normalizeDescription(input);
  if (actual !== expected) {
    failures++;
    console.error(`FAIL\ninput:    ${input}\nexpected: ${expected}\nactual:   ${actual}`);
  } else {
    console.log(`PASS ${actual}`);
  }
}

process.exitCode = failures ? 1 : 0;
