import type { EmperorDataset, PersonRecord, RelationshipEdge, SourceEvidence } from '../types/domain'

interface EmperorSeed {
  id: string
  name: string
  wikipediaTitle: string
  reignStart: string
  reignEnd: string
  predecessors: string[]
}

const wikipediaUrl = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

const edgeEvidence = (targetTitle: string): SourceEvidence[] => [
  {
    sourceName: 'Wikipedia',
    sourceUrl: wikipediaUrl(targetTitle),
    retrievedAt: '2026-04-10',
  },
]

const emperorSeeds: EmperorSeed[] = [
  { id: 'augustus', name: 'Augustus', wikipediaTitle: 'Augustus', reignStart: '27 BCE', reignEnd: '14 CE', predecessors: [] },
  { id: 'tiberius', name: 'Tiberius', wikipediaTitle: 'Tiberius', reignStart: '14 CE', reignEnd: '37 CE', predecessors: ['augustus'] },
  { id: 'caligula', name: 'Caligula', wikipediaTitle: 'Caligula', reignStart: '37 CE', reignEnd: '41 CE', predecessors: ['tiberius'] },
  { id: 'claudius', name: 'Claudius', wikipediaTitle: 'Claudius', reignStart: '41 CE', reignEnd: '54 CE', predecessors: ['caligula'] },
  { id: 'nero', name: 'Nero', wikipediaTitle: 'Nero', reignStart: '54 CE', reignEnd: '68 CE', predecessors: ['claudius'] },
  { id: 'galba', name: 'Galba', wikipediaTitle: 'Galba', reignStart: '68 CE', reignEnd: '69 CE', predecessors: ['nero'] },
  { id: 'otho', name: 'Otho', wikipediaTitle: 'Otho', reignStart: '69 CE', reignEnd: '69 CE', predecessors: ['galba'] },
  { id: 'vitellius', name: 'Vitellius', wikipediaTitle: 'Vitellius', reignStart: '69 CE', reignEnd: '69 CE', predecessors: ['otho'] },
  { id: 'vespasian', name: 'Vespasian', wikipediaTitle: 'Vespasian', reignStart: '69 CE', reignEnd: '79 CE', predecessors: ['vitellius'] },
  { id: 'titus', name: 'Titus', wikipediaTitle: 'Titus', reignStart: '79 CE', reignEnd: '81 CE', predecessors: ['vespasian'] },
  { id: 'domitian', name: 'Domitian', wikipediaTitle: 'Domitian', reignStart: '81 CE', reignEnd: '96 CE', predecessors: ['titus'] },
  { id: 'nerva', name: 'Nerva', wikipediaTitle: 'Nerva', reignStart: '96 CE', reignEnd: '98 CE', predecessors: ['domitian'] },
  { id: 'trajan', name: 'Trajan', wikipediaTitle: 'Trajan', reignStart: '98 CE', reignEnd: '117 CE', predecessors: ['nerva'] },
  { id: 'hadrian', name: 'Hadrian', wikipediaTitle: 'Hadrian', reignStart: '117 CE', reignEnd: '138 CE', predecessors: ['trajan'] },
  { id: 'antoninus-pius', name: 'Antoninus Pius', wikipediaTitle: 'Antoninus Pius', reignStart: '138 CE', reignEnd: '161 CE', predecessors: ['hadrian'] },
  { id: 'marcus-aurelius', name: 'Marcus Aurelius', wikipediaTitle: 'Marcus Aurelius', reignStart: '161 CE', reignEnd: '180 CE', predecessors: ['antoninus-pius'] },
  { id: 'lucius-verus', name: 'Lucius Verus', wikipediaTitle: 'Lucius Verus', reignStart: '161 CE', reignEnd: '169 CE', predecessors: ['antoninus-pius'] },
  { id: 'commodus', name: 'Commodus', wikipediaTitle: 'Commodus', reignStart: '180 CE', reignEnd: '192 CE', predecessors: ['marcus-aurelius'] },
  { id: 'pertinax', name: 'Pertinax', wikipediaTitle: 'Pertinax', reignStart: '193 CE', reignEnd: '193 CE', predecessors: ['commodus'] },
  { id: 'didius-julianus', name: 'Didius Julianus', wikipediaTitle: 'Didius Julianus', reignStart: '193 CE', reignEnd: '193 CE', predecessors: ['pertinax'] },
  { id: 'septimius-severus', name: 'Septimius Severus', wikipediaTitle: 'Septimius Severus', reignStart: '193 CE', reignEnd: '211 CE', predecessors: ['didius-julianus'] },
  { id: 'caracalla', name: 'Caracalla', wikipediaTitle: 'Caracalla', reignStart: '198 CE', reignEnd: '217 CE', predecessors: ['septimius-severus'] },
  { id: 'geta', name: 'Geta', wikipediaTitle: 'Geta (emperor)', reignStart: '209 CE', reignEnd: '211 CE', predecessors: ['septimius-severus'] },
  { id: 'macrinus', name: 'Macrinus', wikipediaTitle: 'Macrinus', reignStart: '217 CE', reignEnd: '218 CE', predecessors: ['caracalla'] },
  { id: 'diadumenian', name: 'Diadumenian', wikipediaTitle: 'Diadumenian', reignStart: '218 CE', reignEnd: '218 CE', predecessors: ['macrinus'] },
  { id: 'elagabalus', name: 'Elagabalus', wikipediaTitle: 'Elagabalus', reignStart: '218 CE', reignEnd: '222 CE', predecessors: ['macrinus'] },
  { id: 'severus-alexander', name: 'Severus Alexander', wikipediaTitle: 'Severus Alexander', reignStart: '222 CE', reignEnd: '235 CE', predecessors: ['elagabalus'] },
  { id: 'maximinus-thrax', name: 'Maximinus Thrax', wikipediaTitle: 'Maximinus Thrax', reignStart: '235 CE', reignEnd: '238 CE', predecessors: ['severus-alexander'] },
  { id: 'gordian-i', name: 'Gordian I', wikipediaTitle: 'Gordian I', reignStart: '238 CE', reignEnd: '238 CE', predecessors: ['maximinus-thrax'] },
  { id: 'gordian-ii', name: 'Gordian II', wikipediaTitle: 'Gordian II', reignStart: '238 CE', reignEnd: '238 CE', predecessors: ['gordian-i'] },
  { id: 'pupienus', name: 'Pupienus', wikipediaTitle: 'Pupienus', reignStart: '238 CE', reignEnd: '238 CE', predecessors: ['maximinus-thrax'] },
  { id: 'balbinus', name: 'Balbinus', wikipediaTitle: 'Balbinus', reignStart: '238 CE', reignEnd: '238 CE', predecessors: ['maximinus-thrax'] },
  { id: 'gordian-iii', name: 'Gordian III', wikipediaTitle: 'Gordian III', reignStart: '238 CE', reignEnd: '244 CE', predecessors: ['pupienus', 'balbinus'] },
  { id: 'philip-the-arab', name: 'Philip the Arab', wikipediaTitle: 'Philip the Arab', reignStart: '244 CE', reignEnd: '249 CE', predecessors: ['gordian-iii'] },
  { id: 'philip-ii', name: 'Philip II', wikipediaTitle: 'Philip II (Roman emperor)', reignStart: '247 CE', reignEnd: '249 CE', predecessors: ['philip-the-arab'] },
  { id: 'decius', name: 'Decius', wikipediaTitle: 'Decius', reignStart: '249 CE', reignEnd: '251 CE', predecessors: ['philip-the-arab'] },
  { id: 'herennius-etruscus', name: 'Herennius Etruscus', wikipediaTitle: 'Herennius Etruscus', reignStart: '251 CE', reignEnd: '251 CE', predecessors: ['decius'] },
  { id: 'hostilian', name: 'Hostilian', wikipediaTitle: 'Hostilian', reignStart: '251 CE', reignEnd: '251 CE', predecessors: ['decius'] },
  { id: 'trebonianus-gallus', name: 'Trebonianus Gallus', wikipediaTitle: 'Trebonianus Gallus', reignStart: '251 CE', reignEnd: '253 CE', predecessors: ['hostilian'] },
  { id: 'volusianus', name: 'Volusianus', wikipediaTitle: 'Volusianus', reignStart: '251 CE', reignEnd: '253 CE', predecessors: ['trebonianus-gallus'] },
  { id: 'aemilian', name: 'Aemilian', wikipediaTitle: 'Aemilianus', reignStart: '253 CE', reignEnd: '253 CE', predecessors: ['trebonianus-gallus'] },
  { id: 'valerian', name: 'Valerian', wikipediaTitle: 'Valerian (emperor)', reignStart: '253 CE', reignEnd: '260 CE', predecessors: ['aemilian'] },
  { id: 'gallienus', name: 'Gallienus', wikipediaTitle: 'Gallienus', reignStart: '253 CE', reignEnd: '268 CE', predecessors: ['valerian'] },
  { id: 'claudius-gothicus', name: 'Claudius Gothicus', wikipediaTitle: 'Claudius Gothicus', reignStart: '268 CE', reignEnd: '270 CE', predecessors: ['gallienus'] },
  { id: 'quintillus', name: 'Quintillus', wikipediaTitle: 'Quintillus', reignStart: '270 CE', reignEnd: '270 CE', predecessors: ['claudius-gothicus'] },
  { id: 'aurelian', name: 'Aurelian', wikipediaTitle: 'Aurelian', reignStart: '270 CE', reignEnd: '275 CE', predecessors: ['quintillus'] },
  { id: 'tacitus', name: 'Tacitus', wikipediaTitle: 'Tacitus (emperor)', reignStart: '275 CE', reignEnd: '276 CE', predecessors: ['aurelian'] },
  { id: 'florianus', name: 'Florianus', wikipediaTitle: 'Florianus', reignStart: '276 CE', reignEnd: '276 CE', predecessors: ['tacitus'] },
  { id: 'probus', name: 'Probus', wikipediaTitle: 'Probus (emperor)', reignStart: '276 CE', reignEnd: '282 CE', predecessors: ['florianus'] },
  { id: 'carus', name: 'Carus', wikipediaTitle: 'Carus', reignStart: '282 CE', reignEnd: '283 CE', predecessors: ['probus'] },
  { id: 'carinus', name: 'Carinus', wikipediaTitle: 'Carinus', reignStart: '283 CE', reignEnd: '285 CE', predecessors: ['carus'] },
  { id: 'numerian', name: 'Numerian', wikipediaTitle: 'Numerian', reignStart: '283 CE', reignEnd: '284 CE', predecessors: ['carus'] },
  { id: 'diocletian', name: 'Diocletian', wikipediaTitle: 'Diocletian', reignStart: '284 CE', reignEnd: '305 CE', predecessors: ['numerian'] },
  { id: 'maximian', name: 'Maximian', wikipediaTitle: 'Maximian', reignStart: '286 CE', reignEnd: '305 CE', predecessors: ['diocletian'] },
  { id: 'constantius-chlorus', name: 'Constantius Chlorus', wikipediaTitle: 'Constantius Chlorus', reignStart: '305 CE', reignEnd: '306 CE', predecessors: ['maximian'] },
  { id: 'galerius', name: 'Galerius', wikipediaTitle: 'Galerius', reignStart: '305 CE', reignEnd: '311 CE', predecessors: ['diocletian'] },
  { id: 'severus-ii', name: 'Severus II', wikipediaTitle: 'Severus II', reignStart: '306 CE', reignEnd: '307 CE', predecessors: ['constantius-chlorus'] },
  { id: 'maxentius', name: 'Maxentius', wikipediaTitle: 'Maxentius', reignStart: '306 CE', reignEnd: '312 CE', predecessors: ['maximian'] },
  { id: 'constantine-i', name: 'Constantine I', wikipediaTitle: 'Constantine the Great', reignStart: '306 CE', reignEnd: '337 CE', predecessors: ['constantius-chlorus'] },
  { id: 'licinius', name: 'Licinius', wikipediaTitle: 'Licinius', reignStart: '308 CE', reignEnd: '324 CE', predecessors: ['galerius'] },
  { id: 'constantine-ii', name: 'Constantine II', wikipediaTitle: 'Constantine II (emperor)', reignStart: '337 CE', reignEnd: '340 CE', predecessors: ['constantine-i'] },
  { id: 'constans', name: 'Constans', wikipediaTitle: 'Constans', reignStart: '337 CE', reignEnd: '350 CE', predecessors: ['constantine-i'] },
  { id: 'constantius-ii', name: 'Constantius II', wikipediaTitle: 'Constantius II', reignStart: '337 CE', reignEnd: '361 CE', predecessors: ['constantine-i'] },
  { id: 'julian', name: 'Julian', wikipediaTitle: 'Julian (emperor)', reignStart: '361 CE', reignEnd: '363 CE', predecessors: ['constantius-ii'] },
  { id: 'jovian', name: 'Jovian (emperor)', wikipediaTitle: 'Jovian (emperor)', reignStart: '363 CE', reignEnd: '364 CE', predecessors: ['julian'] },
  { id: 'valentinian-i', name: 'Valentinian I', wikipediaTitle: 'Valentinian I', reignStart: '364 CE', reignEnd: '375 CE', predecessors: ['jovian'] },
  { id: 'valens', name: 'Valens', wikipediaTitle: 'Valens', reignStart: '364 CE', reignEnd: '378 CE', predecessors: ['valentinian-i'] },
  { id: 'gratian', name: 'Gratian', wikipediaTitle: 'Gratian', reignStart: '367 CE', reignEnd: '383 CE', predecessors: ['valentinian-i'] },
  { id: 'valentinian-ii', name: 'Valentinian II', wikipediaTitle: 'Valentinian II', reignStart: '375 CE', reignEnd: '392 CE', predecessors: ['gratian'] },
  { id: 'theodosius-i', name: 'Theodosius I', wikipediaTitle: 'Theodosius I', reignStart: '379 CE', reignEnd: '395 CE', predecessors: ['gratian'] },
  { id: 'honorius', name: 'Honorius', wikipediaTitle: 'Honorius', reignStart: '393 CE', reignEnd: '423 CE', predecessors: ['theodosius-i'] },
  { id: 'constantine-iii', name: 'Constantine III', wikipediaTitle: 'Constantine III (Western Roman emperor)', reignStart: '407 CE', reignEnd: '411 CE', predecessors: ['honorius'] },
  { id: 'constantius-iii', name: 'Constantius III', wikipediaTitle: 'Constantius III', reignStart: '421 CE', reignEnd: '421 CE', predecessors: ['honorius'] },
  { id: 'joannes', name: 'Joannes', wikipediaTitle: 'Joannes', reignStart: '423 CE', reignEnd: '425 CE', predecessors: ['honorius'] },
  { id: 'valentinian-iii', name: 'Valentinian III', wikipediaTitle: 'Valentinian III', reignStart: '425 CE', reignEnd: '455 CE', predecessors: ['joannes', 'constantius-iii'] },
  { id: 'petronius-maximus', name: 'Petronius Maximus', wikipediaTitle: 'Petronius Maximus', reignStart: '455 CE', reignEnd: '455 CE', predecessors: ['valentinian-iii'] },
  { id: 'avitus', name: 'Avitus', wikipediaTitle: 'Avitus', reignStart: '455 CE', reignEnd: '456 CE', predecessors: ['petronius-maximus'] },
  { id: 'majorian', name: 'Majorian', wikipediaTitle: 'Majorian', reignStart: '457 CE', reignEnd: '461 CE', predecessors: ['avitus'] },
  { id: 'libius-severus', name: 'Libius Severus', wikipediaTitle: 'Libius Severus', reignStart: '461 CE', reignEnd: '465 CE', predecessors: ['majorian'] },
  { id: 'anthemius', name: 'Anthemius', wikipediaTitle: 'Anthemius', reignStart: '467 CE', reignEnd: '472 CE', predecessors: ['libius-severus'] },
  { id: 'olybrius', name: 'Olybrius', wikipediaTitle: 'Olybrius', reignStart: '472 CE', reignEnd: '472 CE', predecessors: ['anthemius'] },
  { id: 'glycerius', name: 'Glycerius', wikipediaTitle: 'Glycerius', reignStart: '473 CE', reignEnd: '474 CE', predecessors: ['olybrius'] },
  { id: 'julius-nepos', name: 'Julius Nepos', wikipediaTitle: 'Julius Nepos', reignStart: '474 CE', reignEnd: '475 CE', predecessors: ['glycerius'] },
  { id: 'romulus-augustulus', name: 'Romulus Augustulus', wikipediaTitle: 'Romulus Augustulus', reignStart: '475 CE', reignEnd: '476 CE', predecessors: ['julius-nepos'] },
]

const people: PersonRecord[] = emperorSeeds.map((seed) => ({
  id: seed.id,
  name: seed.name,
  isEmperor: true,
  reignStart: seed.reignStart,
  reignEnd: seed.reignEnd,
  shortBio: `Roman emperor, attested in Wikipedia coverage of imperial chronology.`,
  wikipediaTitle: seed.wikipediaTitle,
  wikipediaUrl: wikipediaUrl(seed.wikipediaTitle),
}))

const relationships: RelationshipEdge[] = emperorSeeds.flatMap((seed) =>
  seed.predecessors.map((fromId) => ({
    id: `succ-${fromId}-${seed.id}`,
    from: fromId,
    to: seed.id,
    type: 'succession',
    label: 'succession',
    evidence: edgeEvidence(seed.wikipediaTitle),
  })),
)

export const seedWesternEmperors: EmperorDataset = {
  title: 'Western Roman Emperors (Wikipedia Graph)',
  scope: 'Commonly listed Western Roman imperial succession from Augustus to Romulus Augustulus',
  lastUpdated: '2026-04-10',
  people,
  relationships,
}
