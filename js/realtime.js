function subscribeScanRealtime(onChange) {
  const channel = window.supabaseClient
    .channel('scan-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scan' },
      (payload) => {
        console.log('Scan berubah:', payload);
        if (typeof onChange === 'function') onChange(payload);
      }
    )
    .subscribe();

  return channel; // simpan supaya bisa unsubscribe nanti
}

// Pemakaian di dashboard / mode scan:
// subscribeScanRealtime(() => loadDashboardData());
