async function callApi(action, payload = {}) {
  const sb = window.supabaseClient;

  switch (action) {
    case 'login': {
      const hash = await sha256(payload.password);
      const { data, error } = await sb
        .from('admins')
        .select('username, nama, role')
        .eq('username', payload.username)
        .eq('password_hash', hash)
        .maybeSingle();
      if (error || !data) return { success: false, message: 'Username atau Password salah!' };
      return { success: true, message: 'Login Berhasil', user: data };
    }

    case 'processScan': {
      const { data, error } = await sb.rpc('process_scan', {
        p_barcode: payload.barcode,
        p_session: payload.session,
        p_device:  payload.device || 'GitHub-Kiosk',
        p_metode:  payload.metode || 'kamera'
      });
      return data || { success: false, message: error?.message };
    }

    case 'confirmSecondMeal': {
      const { data, error } = await sb.rpc('confirm_second_meal', {
        p_nis: payload.nis,
        p_session: payload.session
      });
      return data || { success: false, message: error?.message };
    }

    case 'getAllSantri': {
      const { data, error } = await sb.from('santri').select('*').order('nama');
      return { success: !error, data: data || [], message: error?.message };
    }

    case 'addSantri': {
      const s = payload.santriData;
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
      const list = (payload.list || []).map(s => ({
        ...s,
        barcode: s.barcode || s.nis,
        status:  s.status || 'Aktif'
      }));
      const { error } = await sb.from('santri').upsert(list, { onConflict: 'nis' });
      return {
        success: !error,
        message: error ? error.message : `Import selesai: ${list.length} baris`,
        data: { success: list.length, failed: 0 }
      };
    }

    case 'getSettings': {
      const { data, error } = await sb.from('settings').select('*').eq('id', 'general').single();
      if (error) return { success: false, message: error.message };
      // jadwal_makan sudah JSONB → object
      return { success: true, data };
    }

    case 'saveSettings': {
      const { error } = await sb.from('settings').upsert({ id: 'general', ...payload.settingsData });
      return { success: !error, message: error ? error.message : 'Pengaturan berhasil disimpan' };
    }

    // Dashboard stats & detail → kita hitung di frontend dulu (sederhana)
    // atau buat view/function Postgres nanti

    default:
      return { success: false, message: `Action '${action}' belum diimplementasi` };
  }
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
