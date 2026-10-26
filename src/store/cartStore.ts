import { create } from "zustand";

export interface CartItem {
  id: string;
  type: "ticket" | "product" | "event" | "membership" | "donation";
  name: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  totalPrice: number;
  referenceId?: number;
}

interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "id" | "totalPrice">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTotalDiscount: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addItem: (item) => {
    const id = `${item.type}-${item.referenceId ?? Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const totalPrice = Math.round(
      item.quantity * item.unitPrice * (1 - item.discountPercent / 100),
    );
    set((state) => ({ items: [...state.items, { ...item, id, totalPrice }] }));
  },
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  updateQuantity: (id, quantity) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id
          ? {
              ...i,
              quantity,
              totalPrice: Math.round(quantity * i.unitPrice * (1 - i.discountPercent / 100)),
            }
          : i,
      ),
    })),
  clearCart: () => set({ items: [] }),
  getSubtotal: () => get().items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
  getTotalDiscount: () =>
    get().items.reduce(
      (s, i) => s + Math.round(i.quantity * i.unitPrice * (i.discountPercent / 100)),
      0,
    ),
  getTotal: () => get().items.reduce((s, i) => s + i.totalPrice, 0),
  getItemCount: () => get().items.reduce((s, i) => s + i.quantity, 0),
}));
