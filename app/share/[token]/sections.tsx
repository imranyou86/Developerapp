import Image from "next/image";

function currency(n: number): string {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface PlanPage {
  id: string;
  storage_url: string;
  label: string;
  sort_order: number;
}

export function PlanSection({ pages }: { pages: PlanPage[] }) {
  if (pages.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-blueprint-dark">Plan</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {pages.map((p) => (
          <div key={p.id} className="card overflow-hidden">
            <div className="relative aspect-[4/3] bg-concrete">
              <Image src={p.storage_url} alt={p.label} fill className="object-contain" unoptimized />
            </div>
            <p className="truncate p-2 text-xs text-blueprint/70">{p.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

interface RoomTask {
  id: string;
  title: string;
  due_date: string | null;
  done: boolean;
}
interface RoomBudgetItem {
  id: string;
  item: string;
  budgeted: number;
  actual: number;
}
interface RoomFinish {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  price: number | null;
}
interface RoomRendering {
  id: string;
  style: string;
  illustration_svg: string | null;
  uploaded_photo_url: string | null;
  description: string | null;
}
export interface ShareRoom {
  id: string;
  name: string;
  type: string | null;
  width: number | null;
  depth: number | null;
  floor: number | null;
  estimated: boolean;
  tasks: RoomTask[];
  budget_items: RoomBudgetItem[];
  finishes: RoomFinish[];
  renderings: RoomRendering[];
}

export function RoomsSection({ rooms }: { rooms: ShareRoom[] }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-blueprint-dark">Rooms &amp; tasks</h2>
      {rooms.length === 0 ? (
        <p className="text-sm text-blueprint/50">No rooms yet.</p>
      ) : (
        <div className="space-y-4">
          {rooms.map((room) => {
            const tasksDone = room.tasks.filter((t) => t.done).length;
            return (
              <div key={room.id} className="card p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-blueprint-dark">
                      {room.name}
                      {room.estimated && <span className="badge-amber ml-2">estimated dims</span>}
                    </h3>
                    <p className="text-xs text-blueprint/50">
                      {room.type ?? "Room"} {room.floor != null && `· Floor ${room.floor}`}
                      {room.width && room.depth && ` · ${room.width}ft × ${room.depth}ft`}
                    </p>
                  </div>
                  <span className="text-xs text-blueprint/50">
                    {tasksDone}/{room.tasks.length} tasks
                  </span>
                </div>

                {room.tasks.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {room.tasks.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-sm">
                        <span>{t.done ? "☑" : "☐"}</span>
                        <span className={t.done ? "text-blueprint/40 line-through" : ""}>{t.title}</span>
                        {t.due_date && <span className="ml-auto text-xs text-blueprint/50">{t.due_date}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {room.renderings.length > 0 && (
                  <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {room.renderings.map((r) => (
                      <div key={r.id} className="overflow-hidden rounded-lg border border-blueprint/10">
                        <div className="relative aspect-[4/3] bg-concrete">
                          {r.uploaded_photo_url ? (
                            <Image src={r.uploaded_photo_url} alt={r.style} fill className="object-cover" unoptimized />
                          ) : r.illustration_svg ? (
                            <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: r.illustration_svg }} />
                          ) : null}
                        </div>
                        <p className="p-1.5 text-[11px] text-blueprint/60">{r.style}</p>
                      </div>
                    ))}
                  </div>
                )}

                {room.finishes.length > 0 && (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-blueprint/50">
                        <th className="py-1 pr-4 font-medium">Item</th>
                        <th className="py-1 pr-4 font-medium">Category</th>
                        <th className="py-1 pr-4 font-medium">Brand / Model</th>
                        <th className="py-1 font-medium">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {room.finishes.map((f) => (
                        <tr key={f.id} className="border-t border-blueprint/5">
                          <td className="py-1.5 pr-4">{f.name}</td>
                          <td className="py-1.5 pr-4 text-blueprint/60">{f.category}</td>
                          <td className="py-1.5 pr-4 text-blueprint/60">{f.brand ?? "—"}</td>
                          <td className="py-1.5">{f.price != null ? currency(f.price) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface ChecklistPhoto {
  id: string;
  storage_url: string;
}
interface ChecklistItem {
  id: string;
  phase: "rough" | "finish";
  title: string;
  done: boolean;
  comment: string | null;
  checklist_photos: ChecklistPhoto[];
}

function ChecklistColumn({ title, items }: { title: string; items: ChecklistItem[] }) {
  const done = items.filter((i) => i.done).length;
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-blueprint-dark">{title}</h3>
        <span className="text-xs text-blueprint/50">
          {done}/{items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-blueprint/10 p-2 text-sm">
            <div className="flex items-center gap-2">
              <span>{item.done ? "☑" : "☐"}</span>
              <span className={item.done ? "text-blueprint/40 line-through" : ""}>{item.title}</span>
            </div>
            {item.comment && <p className="mt-1 pl-6 text-xs text-blueprint/60">{item.comment}</p>}
            {item.checklist_photos.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5 pl-6">
                {item.checklist_photos.map((photo) => (
                  <div key={photo.id} className="relative h-12 w-12 overflow-hidden rounded-md">
                    <Image src={photo.storage_url} alt="" fill className="object-cover" unoptimized />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChecklistSection({ items }: { items: ChecklistItem[] }) {
  const rough = items.filter((i) => i.phase === "rough");
  const finish = items.filter((i) => i.phase === "finish");
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-blueprint-dark">Checklist</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChecklistColumn title="Rough-in" items={rough} />
        <ChecklistColumn title="Finish" items={finish} />
      </div>
    </section>
  );
}

export function BudgetSection({ rooms }: { rooms: ShareRoom[] }) {
  const totalBudgeted = rooms.reduce((sum, r) => sum + r.budget_items.reduce((s, i) => s + Number(i.budgeted), 0), 0);
  const totalActual = rooms.reduce((sum, r) => sum + r.budget_items.reduce((s, i) => s + Number(i.actual), 0), 0);
  const roomsWithBudget = rooms.filter((r) => r.budget_items.length > 0);

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-blueprint-dark">Budget</h2>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Total budgeted</p>
          <p className="mt-1 text-xl font-semibold text-blueprint-dark">{currency(totalBudgeted)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Total actual</p>
          <p className="mt-1 text-xl font-semibold text-blueprint-dark">{currency(totalActual)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-blueprint/50">
            {totalActual > totalBudgeted ? "Over budget" : "Remaining"}
          </p>
          <p className={`mt-1 text-xl font-semibold ${totalActual > totalBudgeted ? "text-red-600" : "text-sage-dark"}`}>
            {currency(Math.abs(totalBudgeted - totalActual))}
          </p>
        </div>
      </div>

      {roomsWithBudget.length > 0 && (
        <div className="space-y-3">
          {roomsWithBudget.map((room) => (
            <div key={room.id} className="card p-5">
              <h3 className="mb-2 font-semibold text-blueprint-dark">{room.name}</h3>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-blueprint/50">
                    <th className="py-1 font-medium">Item</th>
                    <th className="py-1 font-medium">Budgeted</th>
                    <th className="py-1 font-medium">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {room.budget_items.map((item) => (
                    <tr key={item.id} className="border-t border-blueprint/5">
                      <td className="py-1.5">{item.item}</td>
                      <td className="py-1.5">{currency(item.budgeted)}</td>
                      <td className={`py-1.5 ${Number(item.actual) > Number(item.budgeted) ? "text-red-600" : ""}`}>
                        {currency(item.actual)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface PaymentLine {
  id: string;
  label: string;
  amount: number;
  paid: boolean;
}
interface ShareBid {
  id: string;
  contractor: string;
  total_amount: number;
  file_name: string | null;
  file_url: string | null;
  uploaded_at: string;
  payment_schedule_items: PaymentLine[];
}

export function PaymentsSection({ bids }: { bids: ShareBid[] }) {
  if (bids.length === 0) return null;
  const projectTotal = bids.reduce((sum, b) => sum + Number(b.total_amount), 0);
  const projectPaid = bids.reduce(
    (sum, b) => sum + b.payment_schedule_items.filter((l) => l.paid).reduce((s, l) => s + Number(l.amount), 0),
    0
  );

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-blueprint-dark">Payments</h2>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Contracts total</p>
          <p className="mt-1 text-xl font-semibold text-blueprint-dark">{currency(projectTotal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Paid to date</p>
          <p className="mt-1 text-xl font-semibold text-sage-dark">{currency(projectPaid)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Remaining</p>
          <p className="mt-1 text-xl font-semibold text-blueprint-dark">{currency(projectTotal - projectPaid)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {bids.map((bid) => {
          const paid = bid.payment_schedule_items.filter((l) => l.paid).reduce((s, l) => s + Number(l.amount), 0);
          return (
            <div key={bid.id} className="card p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-blueprint-dark">{bid.contractor}</h3>
                <span className="text-xs text-blueprint/50">
                  {currency(paid)} paid of {currency(bid.total_amount)}
                </span>
              </div>
              <div className="space-y-1">
                {bid.payment_schedule_items.map((line) => (
                  <div key={line.id} className="flex items-center gap-2 text-sm">
                    <span>{line.paid ? "☑" : "☐"}</span>
                    <span className={`flex-1 ${line.paid ? "text-blueprint/40 line-through" : ""}`}>{line.label}</span>
                    <span className="font-medium">{currency(line.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
