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
): VehicleKmCost[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const ordersByVehicle = new Map<string, Map<string, string | null>>();

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
    return calculateVehicleKmCosts(vehicleOrders, vehicle);
  });
}
