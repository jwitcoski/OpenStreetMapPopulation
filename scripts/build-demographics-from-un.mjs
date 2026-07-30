#!/usr/bin/env node
/*
 * Rebuild public/demographics.json from the UN DESA household-size Excel file.
 *
 * Usage:
 *   node scripts/build-demographics-from-un.mjs [/path/to/undesa_pd_2022_hh-size-composition.xlsx]
 *
 * Downloads the official workbook when no path is given.
 */

import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const xlsxPath = process.argv[2] || '/tmp/un_hh.xlsx';
const datasetUrl =
  'https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2022_hh-size-composition.xlsx';

if (!process.argv[2]) {
  const curl = spawnSync(
    'curl',
    ['-fsSL', '-A', 'Mozilla/5.0', '-o', xlsxPath, datasetUrl],
    { stdio: 'inherit' }
  );
  if (curl.status !== 0) process.exit(curl.status ?? 1);
}

const py = `
import zipfile, re, xml.etree.ElementTree as ET, json, sys
from datetime import datetime, timedelta
from pathlib import Path

xlsx = Path(${JSON.stringify(xlsxPath)})
out = Path(${JSON.stringify(path.join(root, 'public/demographics.json'))})
z = zipfile.ZipFile(xlsx)
ss = ET.fromstring(z.read('xl/sharedStrings.xml'))
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
strings=[]
for si in ss.findall('m:si', ns):
  texts = [t.text or '' for t in si.findall('.//m:t', ns)]
  strings.append(''.join(texts))
root_xml = ET.fromstring(z.read('xl/worksheets/sheet3.xml'))

def excel_year(serial):
  try: serial=float(serial)
  except Exception: return None
  if 1950 <= serial <= 2035: return int(serial)
  return (datetime(1899, 12, 30) + timedelta(days=serial)).year

SRC_WEIGHT = {'DYB':5,'IPUMS':4,'DHS':3,'MICS':3,'LFS':2}
SHORT_NAMES = {
  'United States of America': 'United States',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'Russian Federation': 'Russia',
  'Viet Nam': 'Vietnam',
  'Iran (Islamic Republic of)': 'Iran',
  'Bolivia (Plurinational State of)': 'Bolivia',
  'Venezuela (Bolivarian Republic of)': 'Venezuela',
  'Micronesia (Federated States of)': 'Micronesia',
  'United Republic of Tanzania': 'Tanzania',
  'Democratic Republic of the Congo': 'DR Congo',
  "Lao People's Democratic Republic": 'Laos',
  'Syrian Arab Republic': 'Syria',
  'Republic of Korea': 'South Korea',
  "Democratic People's Republic of Korea": 'North Korea',
  'China, Hong Kong Special Administrative Region': 'Hong Kong',
  'China, Macao Special Administrative Region': 'Macao',
  'State of Palestine': 'Palestine',
  'Republic of Moldova': 'Moldova',
  'Brunei Darussalam': 'Brunei',
}

def slugify(name):
  s = re.sub(r'[^a-z0-9]+', '-', name.casefold()).strip('-')
  return s or 'country'

latest = {}
for row in root_xml.findall('m:sheetData/m:row', ns):
  vals={}
  for c in row.findall('m:c', ns):
    ref=c.attrib['r']; col=re.match(r'[A-Z]+', ref).group(0)
    t=c.attrib.get('t'); v=c.find('m:v', ns)
    if v is None: continue
    vals[col]= strings[int(v.text)] if t=='s' else v.text
  name = vals.get('A')
  if not name or name == 'Country or area': continue
  raw = vals.get('E')
  if raw in (None, '', '..'): continue
  try: size = float(raw)
  except Exception: continue
  if not (1.0 <= size <= 15.0): continue
  year = excel_year(vals.get('D')) or 0
  source = vals.get('C') or ''
  weight = SRC_WEIGHT.get(source, 1)
  prev = latest.get(name)
  better = (not prev or year > prev['year'] or (year == prev['year'] and weight > prev['weight']))
  if better:
    latest[name] = {
      'year': year, 'weight': weight, 'householdSize': round(size, 2),
      'householdSizeYear': year or None, 'dataSource': source, 'iso': vals.get('B'),
      'officialName': name,
    }

presets=[]
for official, row in sorted(latest.items(), key=lambda kv: SHORT_NAMES.get(kv[0], kv[0]).casefold()):
  display = SHORT_NAMES.get(official, official)
  hh = row['householdSize']
  presets.append({
    'id': slugify(display),
    'name': display,
    'householdSize': hh,
    'householdSizeYear': row['householdSizeYear'],
    'unName': official,
    'isoNumeric': row['iso'],
    'dataSource': row['dataSource'],
    'pctResidential': 80,
    'occupancy': 90,
    'sqmPerHousehold': 70,
    'pctMapped': 90,
  })

seen={}
for p in presets:
  base=p['id']
  if base not in seen:
    seen[base]=1
  else:
    seen[base]+=1
    p['id']=f"{base}-{seen[base]}"

presets.append({
  'id':'custom','name':'Custom','householdSize':2.5,
  'pctResidential':80,'occupancy':90,'sqmPerHousehold':70,'pctMapped':100,
})

data={
  'source': {
    'label': 'UN DESA Household Size and Composition 2022',
    'url': 'https://www.un.org/development/desa/pd/data/household-size-and-composition',
    'dataset': ${JSON.stringify(datasetUrl)},
    'countriesNote': 'Average household size for each country/area is the latest available estimate from the UN DESA Database on Household Size and Composition 2022 Excel table. Occupancy, floor area per household, residential share, and mapped completeness are estimation defaults for this tool (not from UN DESA).',
  },
  'defaultPresetId': 'united-states',
  'presets': presets,
}
out.write_text(json.dumps(data, indent=2) + '\\n')
print(f'wrote {out} ({len(presets)} presets)')
`;

const result = spawnSync('python3', ['-c', py], { stdio: 'inherit' });
process.exit(result.status ?? 1);
