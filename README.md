# KesKlip

KesKlip, Windows için hızlı ve sade bir video kırpma stüdyosudur. Uzun videoları yeniden kodlamadan, dosyayı kopyalamadan açar; kırpma, bölme, sıralama, hız, geçiş, yazı ve müzik ekleyip tek tıkla MP4 olarak dışa aktarır.

## İndirme

- **Taşınabilir sürüm:** [Releases](https://github.com/Aphelioxe/kesklip/releases) sayfasından `KesKlip-Portable.exe` dosyasını indir. Kurulum gerektirmez.
- **Kaynak koddan derleme:** aşağıdaki [Geliştirme](#geliştirme) bölümüne bak.

## Hızlı başlangıç

1. **KesKlip**'i çalıştır (`KesKlip-Portable.exe`). Kurulum gerekmez.
2. Sol üstteki **Videoları içe aktar** alanına tıkla veya videonu pencerenin üzerine sürükle.
3. Zaman çizelgesinde klibi seç; sağdaki **Özellikler** panelinden kırp, böl, hızlandır; giriş/çıkış solması ve altı farklı geçiş ekle.
4. **Yazı** sekmesinden başlık veya alt yazı ekle; yazıyı önizleme üzerinde sürükleyerek konumlandır.
5. **Ses** sekmesinden arka plan müziği ekle.
6. Sağ üstteki **Dışa Aktar** düğmesiyle videoyu MP4 olarak kaydet.

Kaynak videolar hiçbir zaman kopyalanmaz veya değiştirilmez. KesKlip yalnızca dosyanın yolunu projede saklar.

## Kurulum ve taşınabilirlik

- **Tek dosyalık taşınabilir sürüm:** `KesKlip-Portable.exe`. Kurulum gerektirmez. Her açılışta kendini geçici klasöre çıkardığı için ilk açılış 1–2 dakika sürebilir.
- **Geliştirici derlemesi:** `npm run dist` → `dist\KesKlip-Portable.exe`.

## Özellikler

- 40 dakikalık ve daha uzun videoları saniyeler içinde içe aktarma (yeniden kodlama yok).
- Sürükle-bırak ile içe aktarma.
- Kırpma tutamaçları, imleçten bölme, silme, çoğaltma ve sürükleyerek sıralama.
- 0.5x / 1x / 1.5x / 2x hız, klip ses seviyesi ve klip başına giriş/çıkış solması (görüntü + ses birlikte).
- Altı geçiş: **Yumuşak** (fade), **Beyaz** (flash), **Kaydır** (slide), **Yakınlaş** (zoom), **Perde** (wipe), **Daire** (circle).
- Dışa aktarmada ses normalizasyonu (-16 LUFS) ve isteğe bağlı hafif gürültü azaltma.
- Metin katmanları: boyut, renk, kalın yazı, arka plan kutusu, solma, konum ve zamanlama.
- Arka plan müziği: ses seviyesi, döngü, giriş/çıkış solması.
- Orijinal çözünürlükte dışa aktarma; isteğe bağlı 720p, 1080p, 4K, dikey ve kare proje ayarları.
- NVIDIA NVENC varsa GPU ile hızlı dışa aktarma; yoksa CPU (libx264) ile çalışır.
- Otomatik kayıt ve `.kesklip` proje dosyaları.
- Ctrl+Z / Ctrl+Shift+Z ile geri al / yinele.
- Türkçe arayüz, koyu tema, tek dosya taşınabilir uygulama.

## Klavye kısayolları

| Kısayol | İşlem |
| --- | --- |
| `Space` | Oynat / duraklat |
| `S` | İmleçten böl |
| `Delete` | Seçileni sil |
| `Ctrl` + `Z` | Geri al |
| `Ctrl` + `Shift` + `Z` | Yinele |
| `Ctrl` + `S` | Projeyi kaydet |
| `Ctrl` + `E` | Dışa aktar |
| `Ctrl` + `I` | Video içe aktar |
| `Ctrl` + `O` | Proje aç |
| `Ctrl` + `N` | Yeni proje |
| `Home` / `End` | Başa / sona git |
| `←` / `→` | Kare kare ilerle |
| `Ctrl` + `+` / `-` | Yakınlaştır / uzaklaştır |
| `?` | Kısayollar penceresi (arayüzdeki Kısayollar düğmesi) |

## Dosya konumları

- **Proje dosyaları:** `.kesklip` uzantılı JSON dosyaları. İstediğin yere kaydedebilirsin.
- **Otomatik kayıt:** Windows kullanıcı verisi klasöründe tutulur; uygulama açılınca son oturum geri yüklenir.
- **Önizleme önbelleği:** `D:\KesKlip\cache` (D: sürücüsü yoksa `%LOCALAPPDATA%\KesKlip\cache`).
- **Varsayılan dışa aktarma:** `D:\KesKlip\exports` (D: yoksa Videolar klasörü).
- Önbellek ve dışa aktarma klasörlerini değiştirmek için `KESKLIP_CACHE_DIR` ve `KESKLIP_EXPORT_DIR` ortam değişkenlerini kullanabilirsin.

Tarayıcının doğrudan oynatamadığı biçimler (ör. bazı MKV / HEVC dosyaları) için KesKlip arka planda hızlı bir önizleme kopyası hazırlar. Bu işlem yalnızca önizleme içindir; dışa aktarma her zaman orijinal kaynak dosyayı kullanır.

## Sorun giderme

- **Windows SmartScreen uyarısı:** Uygulama kod imzası olmadığı için görülebilir. “Daha fazla bilgi” → “Yine de çalıştır” ile açabilirsin.
- **Kaynak dosya bulunamadı:** Video taşınmış veya silinmişse kitaplıkta “dosya yok” olarak işaretlenir. Dosyayı eski konumuna getir veya projeden klibi kaldır.
- **Dışa aktarma başarısız:** Uygulama hata günlüğünü `D:\KesKlip\cache\logs` klasörüne yazar. Donanım kodlayıcı sorun çıkarırsa CPU ile yeniden deneyebilirsin.
- **Önizleme takılıyor:** Büyük / egzotik dosyalarda önizleme kopyasının hazırlanmasını bekle. Kaynak dosya hiçbir zaman değiştirilmez.

## Geliştirme

```powershell
npm install
npm start          # geliştirme modunda çalıştır
npm run check      # JavaScript sözdizimi denetimi
npm run dist       # taşınabilir exe üret: dist\KesKlip-Portable.exe
```

Uygulama Electron + vanilla HTML/CSS/JS ile yazılmıştır. FFmpeg ve FFprobe pakete gömülüdür.

### Otomatik testler

- `node scripts/e2e-smoke.js` — içe aktarma, düzenleme, altı geçiş, klip fade'leri, ses normalizasyonu/gürültü azaltma filtreleri, dışa aktarma, otomatik kayıt ve çevrimdışı dosya denetimi.
- `node scripts/e2e-long.js` — 40 dakikalık video ile hızlı içe aktarma ve zaman çizelgesi testi (test dosyası `D:\KesKlip\smoke\long40.mp4`).
- `node scripts/e2e-packaged.js` — paketlenmiş exe üzerinde açılış, içe aktarma, önizleme ve dışa aktarma testi. Varsayılan olarak `dist\win-unpacked\KesKlip.exe` (yoksa `D:\KesKlip\app\KesKlip.exe`) kullanılır; başka bir exe için `KESKLIP_EXE` ortam değişkenini ayarla.
- `node scripts/check-ui.js` — eksik ikon / DOM referansı denetimi.

## Lisans

MIT. FFmpeg, FFmpeg lisansına tabidir.
