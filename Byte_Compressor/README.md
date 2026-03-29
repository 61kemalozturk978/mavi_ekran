# ByteCompressor

**Derin Uzay İletişiminde Kayıpsız Veri Sıkıştırma Sistemi**

Dar bant genişliğinde uzay haberleşmesi için geliştirilmiş, Shannon entropi sınırına yakın performans sağlayan yeni nesil veri sıkıştırma algoritması.

---

## Hızlı Başlangıç

```bash
# Tüm testleri çalıştır
node bytecomp.js test

# Otomatik demo (4 farklı veri tipi)
node bytecomp.js demo

# Dosya sıkıştır
node bytecomp.js compress dosya.bin dosya.byco

# Dosya aç (decompress)
node bytecomp.js decompress dosya.byco dosya_restored.bin

# Entropi analizi
node bytecomp.js analyze dosya.bin

# Tüm profilleri karşılaştır
node bytecomp.js benchmark dosya.bin
```

## Web Arayüzü (GUI)

```bash
node gui/server.js
```

Tarayıcıda `http://localhost:7845` adresinde açılır. Arayüzde:

- **Dosya yükleme** — Sürükle-bırak veya tıklayarak dosya seçin
- **Sıkıştır / Çıkar** — Profil seçerek veya otomatik modda sıkıştırma/açma
- **Animasyonlu pipeline** — Sıkıştırma aşamalarının görsel akışı
- **Analiz** — Entropi, byte frekans dağılımı, önerilen profil
- **Benchmark** — Tüm 7 profili karşılaştırma tablosu

## Gereksinimler

- **Node.js** v14 veya üzeri (başka bağımlılık yok)

## Proje Yapısı

```
Byte_Compressor/
├── bytecomp.js              ← Ana CLI (komut satırı arayüzü)
├── package.json
├── Makefile                  ← C referans kodu için build sistemi
├── src/
│   ├── core/
│   │   ├── ans_codec.js      ← rANS entropy kodlayıcı
│   │   ├── preprocessor.js   ← BWT, MTF, Delta, RLE dönüşümleri
│   │   ├── context_model.js  ← ANS ile sıkıştırma/açma
│   │   ├── block_codec.js    ← Blok tabanlı dosya codec
│   │   ├── byte_compressor.js← Ana API (analiz, profil seçimi)
│   │   ├── bitstream.js      ← Bit seviyesi I/O
│   │   ├── crc32.js          ← CRC32 integrity kontrolü
│   │   ├── ans_codec.c/h     ← C referans implementasyonu
│   │   ├── preprocessor.c/h  ← C referans implementasyonu
│   │   ├── context_model.c/h ← C referans implementasyonu
│   │   ├── block_codec.c/h   ← C referans implementasyonu
│   │   └── byte_compressor.c/h ← C referans implementasyonu
│   ├── cli/
│   │   └── main.c            ← C referans CLI
│   └── utils/
│       ├── bitstream.c/h     ← C referans bitstream
│       ├── crc32.c/h         ← C referans CRC32
│       └── memory_pool.c/h   ← C referans bellek havuzu
├── gui/
│   ├── server.js             ← Web sunucusu (API + statik dosyalar)
│   └── public/
│       └── index.html        ← Tek dosyalı web arayüzü
├── sample_data/              ← Test verileri
├── tests/                    ← Ek test araçları
└── docs/
    └── algorithm_spec.md     ← Algoritma teknik dokümantasyonu
```

## Lisans

MIT
