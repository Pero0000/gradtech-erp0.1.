export interface VehicleKmOrder {
  id: string;
  broj: string;
  gradiliste_id: string | null;
  km_pocetak: number;
  km_kraj: number;
}

export interface VehicleKmCost {
  nalog_id: string;
  gradiliste_id: string | null;
  kategorija: 'put';
  opis: string;
  iznos: number;
  km: number;
}

export interface VehicleKmAssignment {
  nalog_id: string;
  vozilo_id: string;
  gradiliste_id?: string | null;
}

export interface VehicleKmAllocation {
  vozilo_id: string;
  gradiliste_id: string;
  postotak: number;
}

export function calculateVehicleKmCosts(
  orders: VehicleKmOrder[],
  vehicle: { marka: string; model: string | null; cijena_km: number },
): VehicleKmCost[] {
  const cijena = Number(vehicle.cijena_km);
  if (!Number.isFinite(cijena) || cijena <= 0 || orders.length === 0) return [];

  const ordered = [...orders].sort((a, b) => a.broj.localeCompare(b.broj, 'hr'));
  const ukupno = Math.max(...ordered.map((order) => order.km_kraj))
    - Math.min(...ordered.map((order) => order.km_pocetak));
  const [glavni, ...ostali] = ordered;
  const kmOstali = ostali.map((order) => Math.max(0, order.km_kraj - order.km_pocetak));
  const kmGlavni = Math.max(0, ukupno - kmOstali.reduce((sum, km) => sum + km, 0));
  const vozilo = [vehicle.marka, vehicle.model].filter(Boolean).join(' ');

  return [
    { order: glavni, km: kmGlavni },
    ...ostali.map((order, index) => ({ order, km: kmOstali[index] })),
  ]
    .filter(({ km }) => km > 0)
    .map(({ order, km }) => ({
      nalog_id: order.id,
      gradiliste_id: order.gradiliste_id,
      kategorija: 'put',
      opis: `Kilometri: ${vozilo} ${km} km × ${cijena} €/km`,
      iznos: Math.round(km * cijena * 100) / 100,
      km,
    }));
}

export function calculateDailyVehicleKmCosts(
  assignments: VehicleKmAssignment[],
  orders: VehicleKmOrder[],
  vehicles: Array<{ id: string; marka: string; model: string | null; cijena_km: number }>,
  allocations: VehicleKmAllocation[] = [],
): VehicleKmCost[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const ordersByVehicle = new Map<string, Map<string, string | null>>();
  const allocationByVehicleSite = new Map(
    allocations.map((allocation) => [`${allocation.vozilo_id}:${allocation.gradiliste_id}`, allocation.postotak]),
  );

  for (const assignment of assignments) {
    const orders = ordersByVehicle.get(assignment.vozilo_id) ?? new Map<string, string | null>();
    orders.set(assignment.nalog_id, assignment.gradiliste_id ?? null);
    ordersByVehicle.set(assignment.vozilo_id, orders);
  }

  return [...ordersByVehicle.entries()].flatMap(([vehicleId, orderSites]) => {
    const vehicle = vehicleById.get(vehicleId);
    if (!vehicle) throw new Error(`Nije moguće učitati vozilo ${vehicleId} za obračun kilometara.`);
    const vehicleOrders = [...orderSites.entries()]
      .map(([id, gradilisteId]) => {
        const order = orderById.get(id);
        return order ? { ...order, gradiliste_id: gradilisteId ?? order.gradiliste_id } : null;
      })
      .filter((order): order is VehicleKmOrder => Boolean(order));
    const savedForVehicle = allocations.filter((allocation) => allocation.vozilo_id === vehicleId);
    if (savedForVehicle.length === 0) return calculateVehicleKmCosts(vehicleOrders, vehicle);

    const cijena = Number(vehicle.cijena_km);
    if (!Number.isFinite(cijena) || cijena <= 0 || vehicleOrders.length === 0) return [];

    const ukupnoKm = Math.max(...vehicleOrders.map((order) => order.km_kraj))
      - Math.min(...vehicleOrders.map((order) => order.km_pocetak));
    if (ukupnoKm <= 0) return [];

    const groups = new Map<string, { gradiliste_id: string | null; order: VehicleKmOrder }>();
    for (const order of vehicleOrders.sort((a, b) => a.broj.localeCompare(b.broj, 'hr'))) {
      const key = order.gradiliste_id ?? `nalog:${order.id}`;
      if (!groups.has(key)) groups.set(key, { gradiliste_id: order.gradiliste_id, order });
    }
    const allGroups = [...groups.entries()];
    const assignedSiteGroups = allGroups.filter(([, group]) => group.gradiliste_id !== null);
    const siteGroups = assignedSiteGroups.length > 0 ? assignedSiteGroups : allGroups;
    const savedShares = siteGroups.map(([, group]) =>
      group.gradiliste_id === null ? null : allocationByVehicleSite.get(`${vehicleId}:${group.gradiliste_id}`) ?? null,
    );
    const savedShareTotal = savedShares.reduce<number>((sum, share) => sum + (share ?? 0), 0);
    const useSavedShares = savedShares.every((share) => share !== null)
      && savedShareTotal <= 100;
    const shares = useSavedShares
      ? savedShareTotal > 0
        ? savedShares.map((share) => (share ?? 0) * 100 / savedShareTotal)
        : savedShares.map(() => 0)
      : siteGroups.map(() => 100 / siteGroups.length);
    const totalAmountCents = Math.round(ukupnoKm * cijena * 100);
    const positiveShareIndexes = shares.flatMap((share, index) => share > 0 ? [index] : []);
    let allocatedAmountCents = 0;
    const vozilo = [vehicle.marka, vehicle.model].filter(Boolean).join(' ');

    return siteGroups.flatMap(([, group], index) => {
      const km = ukupnoKm * shares[index] / 100;
      if (km <= 0) return [];
      const iznosCents = index === positiveShareIndexes[positiveShareIndexes.length - 1]
        ? totalAmountCents - allocatedAmountCents
        : Math.round(ukupnoKm * cijena * shares[index] / 100 * 100);
      allocatedAmountCents += iznosCents;
      return [{
        nalog_id: group.order.id,
        gradiliste_id: group.gradiliste_id,
        kategorija: 'put' as const,
        opis: `Kilometri: ${vozilo} ${km.toFixed(2)} km × ${cijena} €/km`,
        iznos: iznosCents / 100,
        km,
      }];
    });
  });
}
