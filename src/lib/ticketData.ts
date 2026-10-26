export interface TicketType {
  id: number;
  name: string;
  category: "normal" | "guided" | "vip";
  base_price: number;
  description: string;
  group_discount_percent: number;
  group_min_count: number;
}

export const TICKET_TYPES: TicketType[] = [
  {
    id: 1,
    name: "بلیط عادی",
    category: "normal",
    base_price: 150000,
    description: "بازدید آزاد از تمامی بخش‌های موزه",
    group_discount_percent: 20,
    group_min_count: 10,
  },
  {
    id: 2,
    name: "بلیط با راهنما",
    category: "guided",
    base_price: 300000,
    description: "بازدید همراه با راهنمای متخصص موزه",
    group_discount_percent: 20,
    group_min_count: 10,
  },
  {
    id: 3,
    name: "بلیط VIP",
    category: "vip",
    base_price: 750000,
    description: "بازدید اختصاصی + پذیرایی در کافه موزه",
    group_discount_percent: 20,
    group_min_count: 5,
  },
];
