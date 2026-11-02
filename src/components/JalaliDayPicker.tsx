import { useMemo } from "react";
import { faIR, getDateLib } from "react-day-picker/persian";

import { Calendar } from "@/components/ui/calendar";
import { dayToLocalDate, localDateToDay } from "@/lib/daily-report";

interface JalaliDayPickerProps {
  /** روز انتخاب‌شده، YYYY-MM-DD میلادی */
  value: string;
  /** آخرین روز قابل انتخاب (امروزِ تهران) */
  max: string;
  onChange: (day: string) => void;
}

/**
 * تقویم شمسی (جلالی) با ارقام فارسی و راست‌به‌چپ. خروجی همیشه روز میلادی YYYY-MM-DD است و با
 * اجزای «محلی» Date تبدیل می‌شود تا منطقهٔ زمانی دستگاه روز را جابه‌جا نکند.
 */
export function JalaliDayPicker({ value, max, onChange }: JalaliDayPickerProps) {
  const dateLib = useMemo(() => getDateLib({ locale: faIR, numerals: "arabext" }), []);
  const selected = dayToLocalDate(value);
  return (
    <Calendar
      mode="single"
      dir="rtl"
      locale={faIR}
      numerals="arabext"
      dateLib={dateLib}
      selected={selected}
      defaultMonth={selected}
      disabled={{ after: dayToLocalDate(max) }}
      onSelect={(date) => {
        if (date) onChange(localDateToDay(date));
      }}
    />
  );
}
