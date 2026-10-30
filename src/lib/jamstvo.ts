export interface JamstvoPodaci {
  aktivno: boolean;
  od: string | null | undefined;
  mjeseci: number | null | undefined;
  doVrijednosti: number | null | undefined;
  trenutnaVrijednost: number | null | undefined;
  jedinica: string;
}

export function jamstvoInfo(jamstvo: JamstvoPodaci) {
  if (!jamstvo.aktivno) {
    return { label: 'Bez jamstva', tone: 'gray' as const, detail: '' };
  }

  const danas = new Date();
  danas.setHours(0, 0, 0, 0);
  const details: string[] = [];
  let expiredByTime = false;
  let expiredByLimit = false;

  if (jamstvo.mjeseci != null) {
    if (!jamstvo.od) {
      details.push('Nedostaje datum početka');
    } else {
      const [year, month, day] = jamstvo.od.slice(0, 10).split('-').map(Number);
      const start = new Date(year, month - 1, day);
      const targetMonth = start.getMonth() + jamstvo.mjeseci;
      const lastDay = new Date(start.getFullYear(), targetMonth + 1, 0).getDate();
      const expiry = new Date(start.getFullYear(), targetMonth, Math.min(start.getDate(), lastDay));
      details.push(`do ${expiry.toLocaleDateString('hr-HR')}`);
      expiredByTime = danas > expiry;
    }
  } else if (jamstvo.od) {
    details.push(`od ${new Date(`${jamstvo.od.slice(0, 10)}T00:00:00`).toLocaleDateString('hr-HR')}`);
  }

  if (jamstvo.doVrijednosti != null) {
    details.push(`do ${jamstvo.doVrijednosti.toLocaleString('hr-HR')} ${jamstvo.jedinica}`);
    expiredByLimit = jamstvo.trenutnaVrijednost != null && jamstvo.trenutnaVrijednost > jamstvo.doVrijednosti;
  }

  if (expiredByTime && expiredByLimit) {
    return { label: 'Isteklo', tone: 'red' as const, detail: details.join(' · ') };
  }
  if (expiredByTime) {
    return { label: 'Isteklo po vremenu', tone: 'red' as const, detail: details.join(' · ') };
  }
  if (expiredByLimit) {
    return { label: 'Isteklo po ograničenju', tone: 'red' as const, detail: details.join(' · ') };
  }
  if (!jamstvo.od && jamstvo.mjeseci != null) {
    return { label: 'Unesi datum početka', tone: 'yellow' as const, detail: details.join(' · ') };
  }
  if (jamstvo.mjeseci == null && jamstvo.doVrijednosti == null) {
    return { label: 'Jamstvo evidentirano', tone: 'yellow' as const, detail: details.join(' · ') };
  }
  return { label: 'Jamstvo vrijedi', tone: 'green' as const, detail: details.join(' · ') };
}
