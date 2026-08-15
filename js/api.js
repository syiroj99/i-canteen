// ============================================================================
// api.js — Jembatan (bridge) semua aksi frontend ke Supabase.
// Menggantikan backend Google Apps Script sepenuhnya.
//
// PENTING: tabel di database memakai snake_case (foto_url, nama_pondok,
// jeda_nambah_menit, jadwal_makan, is_sahur, dst) sedangkan frontend
// (index.html) memakai camelCase (fotoUrl, namaPondok, jedaNambahMenit,
// jadwalMakan, isSahur). File ini yang menjembatani/memetakan dua gaya
// penamaan itu - jangan ubah nama kolom di query di bawah tanpa cek dulu
// nama kolom asli di Supabase (Table Editor).
// ============================================================================

// NOTE: bernama `supabaseApi` (bukan `callApi`) dengan sengaja - index.html
// sudah punya fungsi `callApi(action, payload, callback)` gaya lama (dengan
// antrean offline dsb). Fungsi itu memanggil `supabaseApi` di bawah ini
// sebagai "mesin" barunya, jadi ratusan pemanggilan callApi(...) yang sudah
// ada di index.html TIDAK perlu diubah satu-satu.
async function supabaseApi(action, payload = {}) {
  const sb = window.supabaseClient;
  try {
    switch (action) {

      // ---------------------------------------------------------------- LOGIN
      case 'login': {
        const hash = await sha256(payload.password);
        const { data, error } = await sb.rpc('admin_login', {
          p_username: payload.username,
          p_password_hash: hash
        });
        if (error) return { success: false, message: error.message };
        return data; // sudah berbentuk {success, message, user}
      }

      // ------------------------------------------------------------ SCAN/RPC
      case 'processScan': {
        const { data, error } = await sb.rpc('process_scan', {
          p_barcode: payload.barcode,
          p_session: payload.session,
          p_device:  payload.device || 'GitHub-Kiosk',
          p_metode:  payload.metode || 'kamera'
        });
        if (error) return { success: false, message: error.message };
        return data;
      }

      case 'confirmSecondMeal': {
        const { data, error } = await sb.rpc('confirm_second_meal', {
          p_nis: payload.nis,
          p_session: payload.session
        });
        if (error) return { success: false, message: error.message };
        return data;
      }

      // ------------------------------------------------------------- SANTRI
      case 'getAllSantri': {
        const { data, error } = await sb.from('santri').select('*').order('nama');
        return { success: !error, data: (data || []).map(santriToFrontend_), message: error?.message };
      }

      case 'addSantri': {
        const s = santriToDb_(payload.santriData);
        s.barcode = s.barcode || s.nis;
        s.status  = s.status || 'Aktif';
        const { error } = await sb.from('santri').upsert(s, { onConflict: 'nis' });
        return { success: !error, message: error ? error.message : 'Santri berhasil disimpan' };
      }

      case 'deleteSantri': {
        const { error } = await sb.from('santri').delete().eq('nis', payload.nis);
        return { success: !error, message: error ? error.message : 'Santri berhasil dihapus' };
      }

      case 'importSantri': {
        const list = (payload.list || []).map(s => {
          const row = santriToDb_(s);
          row.barcode = row.barcode || row.nis;
          row.status  = row.status || 'Aktif';
          return row;
        });
        const { error } = await sb.from('santri').upsert(list, { onConflict: 'nis' });
        return {
          success: !error,
          message: error ? error.message : `Import selesai: ${list.length} baris`,
          data: { success: list.length, failed: 0 }
        };
      }

      case 'generateCardData': {
        const { data, error } = await sb.from('santri').select('*').order('nama');
        return { success: !error, data: (data || []).map(santriToFrontend_), message: error?.message };
      }

      // ------------------------------------------------------------ SETTINGS
      case 'getSettings': {
        const { data, error } = await sb.from('settings').select('*').eq('id', 'general').single();
        if (error) return { success: false, message: error.message };
        return { success: true, data: settingsToFrontend_(data) };
      }

      case 'saveSettings': {
        const row = settingsToDb_(payload.settingsData);
        const { error } = await sb.from('settings').upsert({ id: 'general', ...row });
        return { success: !error, message: error ? error.message : 'Pengaturan berhasil disimpan' };
      }

      // ---------------------------------------------------------- DIAGNOSTIK
      case 'ping': {
        const detail = [];
        const t0 = Date.now();
        const { error: readErr } = await sb.from('settings').select('id').eq('id', 'general').maybeSingle();
        detail.push(readErr ? ('Baca settings: GAGAL - ' + readErr.message) : 'Baca settings: OK');
        const { error: writeErr } = await sb.from('settings')
          .update({ id: 'general' })
          .eq('id', 'general');
        detail.push(writeErr ? ('Tulis settings: GAGAL - ' + writeErr.message) : 'Tulis settings: OK');
        detail.push('Latensi: ' + (Date.now() - t0) + ' ms');
        return {
          success: !readErr,
          data: {
            projectId: (window.supabaseClient?.supabaseUrl || '').replace('https://', '').split('.')[0],
            firestoreConfigOk: true,
            firestoreReadOk: !readErr,
            firestoreWriteOk: !writeErr,
            detail
          }
        };
      }

      // ----------------------------------------------------------- DASHBOARD
      // Catatan: tabel `scan` sudah menyimpan salinan nama/kelas/asrama sendiri
      // di setiap baris (snapshot saat scan terjadi), jadi tidak perlu join ke
      // tabel santri untuk menampilkannya - hanya perlu santri untuk hitung
      // total & filter gender (kolom jk cuma ada di tabel santri).
      case 'getDashboardStats': {
        const session  = payload.session || 'pagi';
        const gender   = payload.gender || '';
        const tanggal  = payload.tanggal || todayJakarta_();

        const [{ data: santriList }, { data: scans }] = await Promise.all([
          sb.from('santri').select('nis, jk'),
          sb.from('scan').select('*').eq('tanggal', tanggal)
        ]);

        const santri = filterGender_(santriList || [], gender);
        const nisSet = new Set(santri.map(s => s.nis));
        const scanToday = (scans || []).filter(sc => nisSet.has(sc.nis));

        const bySession = scanToday.filter(sc => sc.session === session);
        const sudahMakanNis = new Set(bySession.filter(sc => sc.jenis === 'PERTAMA').map(sc => sc.nis));
        const nambahCount = bySession.filter(sc => sc.jenis === 'NAMBAH').length;
        const sahurCount = new Set(scanToday.filter(sc => sc.is_sahur).map(sc => sc.nis)).size;

        const totalSantri = santri.length;
        const sudahMakan = sudahMakanNis.size;
        const belumMakan = totalSantri - sudahMakan;
        const persentase = totalSantri > 0 ? Math.round((sudahMakan / totalSantri) * 100) + '%' : '0%';

        const recentScans = bySession
          .slice()
          .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
          .slice(0, 10)
          .map(sc => ({ nama: sc.nama || sc.nis, kelas: sc.kelas || '', asrama: sc.asrama || '', jam: sc.jam, isSahur: !!sc.is_sahur }));

        const data = { totalSantri, belumMakan, persentase, count2x: nambahCount, countPuasa: sahurCount, recentScans };
        data[session] = sudahMakan;

        return { success: true, data };
      }

      case 'getTodayChartData': {
        const gender  = payload.gender || '';
        const tanggal = payload.tanggal || todayJakarta_();

        const [{ data: santriList }, { data: scans }] = await Promise.all([
          sb.from('santri').select('nis, jk'),
          sb.from('scan').select('nis, session').eq('tanggal', tanggal)
        ]);

        const santri = filterGender_(santriList || [], gender);
        const nisSet = new Set(santri.map(s => s.nis));
        const scanToday = (scans || []).filter(sc => nisSet.has(sc.nis));

        const count = sesi => new Set(scanToday.filter(sc => sc.session === sesi).map(sc => sc.nis)).size;
        return { success: true, data: { pagi: count('pagi'), siang: count('siang'), malam: count('malam') } };
      }

      case 'getDashboardDetail': {
        const session = payload.session || 'pagi';
        const gender  = payload.gender || '';
        const kategori = payload.kategori;
        const tanggal = todayJakarta_();

        const [{ data: santriList }, { data: scans }] = await Promise.all([
          sb.from('santri').select('*'),
          sb.from('scan').select('*').eq('tanggal', tanggal).eq('session', session)
        ]);

        const santri = filterGender_(santriList || [], gender);
        const santriByNis = {};
        santri.forEach(s => { santriByNis[s.nis] = s; });

        const pertamaNis = new Set((scans || []).filter(sc => sc.jenis === 'PERTAMA' && santriByNis[sc.nis]).map(sc => sc.nis));
        const nambahNis  = new Set((scans || []).filter(sc => sc.jenis === 'NAMBAH'  && santriByNis[sc.nis]).map(sc => sc.nis));
        const sahurNis   = new Set((scans || []).filter(sc => sc.is_sahur && santriByNis[sc.nis]).map(sc => sc.nis));

        let list;
        if (kategori === 'total') list = santri;
        else if (kategori === 'puasa') list = santri.filter(s => sahurNis.has(s.nis));
        else if (kategori === 'sudahMakan') list = santri.filter(s => pertamaNis.has(s.nis));
        else if (kategori === 'nambah') list = santri.filter(s => nambahNis.has(s.nis));
        else if (kategori === 'belumMakan') list = santri.filter(s => !pertamaNis.has(s.nis));
        else list = [];

        return { success: true, data: list.map(s => ({ nis: s.nis, nama: s.nama, kelas: s.kelas, asrama: s.asrama })) };
      }

      // ------------------------------------------------------------- LAPORAN
      // Langsung dari tabel scan (nama/kelas/asrama sudah tersimpan di situ),
      // filter kelas/asrama dilakukan di JS karena tidak selalu match 1:1
      // dengan santri yang mungkin sudah pindah kelas setelah tanggal scan.
      case 'getReports': {
        let query = sb.from('scan').select('*').order('tanggal', { ascending: false }).order('jam', { ascending: false });
        if (payload.startDate) query = query.gte('tanggal', payload.startDate);
        if (payload.endDate)   query = query.lte('tanggal', payload.endDate);
        if (payload.session)   query = query.eq('session', payload.session);
        if (payload.jenis)     query = query.eq('jenis', payload.jenis);

        const { data: scans, error } = await query;
        if (error) return { success: false, message: error.message };

        let rows = (scans || []).map(sc => ({
          nis: sc.nis, nama: sc.nama || sc.nis, kelas: sc.kelas || '', asrama: sc.asrama || '',
          session: sc.session, jenis: sc.jenis, tanggal: sc.tanggal, jam: sc.jam
        }));
        if (payload.kelas)  rows = rows.filter(r => r.kelas === payload.kelas);
        if (payload.asrama) rows = rows.filter(r => r.asrama === payload.asrama);

        return { success: true, data: rows };
      }

      default:
        return { success: false, message: `Action '${action}' belum diimplementasikan` };
    }
  } catch (err) {
    console.error('supabaseApi error:', action, err);
    // Kegagalan jaringan murni (offline / tidak bisa mencapai Supabase) dilempar ulang
    // supaya pemanggil (callApiQueueable di index.html) bisa mendeteksinya dan
    // mengamankan aksi ini ke antrean lokal, bukan langsung dianggap gagal permanen.
    if (err instanceof TypeError || /fetch|network/i.test(err?.message || '')) {
      throw err;
    }
    return { success: false, message: err?.message || 'Terjadi kesalahan tak terduga.' };
  }
}
window.supabaseApi = supabaseApi;

// ----------------------------------------------------------------------------
// Pemetaan nama kolom: DB (snake_case) <-> Frontend (camelCase)
// ----------------------------------------------------------------------------
function santriToFrontend_(row) {
  if (!row) return row;
  const { foto_url, created_at, updated_at, ...rest } = row;
  return { ...rest, fotoUrl: foto_url };
}
function santriToDb_(obj) {
  if (!obj) return obj;
  const { fotoUrl, ...rest } = obj;
  const row = { ...rest };
  if (fotoUrl !== undefined) row.foto_url = fotoUrl;
  return row;
}
function settingsToFrontend_(row) {
  if (!row) return row;
  return {
    namaPondok: row.nama_pondok,
    subJudul: row.sub_judul,
    logoUrl: row.logo_url,
    jedaNambahMenit: row.jeda_nambah_menit,
    jadwalMakan: row.jadwal_makan
  };
}
function settingsToDb_(obj) {
  if (!obj) return {};
  const row = {};
  if (obj.namaPondok !== undefined)       row.nama_pondok = obj.namaPondok;
  if (obj.subJudul !== undefined)         row.sub_judul = obj.subJudul;
  if (obj.logoUrl !== undefined)          row.logo_url = obj.logoUrl;
  if (obj.jedaNambahMenit !== undefined)  row.jeda_nambah_menit = obj.jedaNambahMenit;
  if (obj.jadwalMakan !== undefined)      row.jadwal_makan = obj.jadwalMakan;
  return row;
}

function filterGender_(list, gender) {
  if (!gender) return list;
  return list.filter(s => (s.jk || '').toUpperCase() === gender.toUpperCase());
}

function todayJakarta_() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
