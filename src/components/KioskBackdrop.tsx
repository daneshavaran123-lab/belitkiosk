import museumBg from "@/assets/museum-hall-bg.jpg";

/**
 * پس‌زمینهٔ مشترک کیوسک: تصویر تالار موزه + سایهٔ ملایم + نورهای رنگی که آرام جابه‌جا می‌شوند.
 * شیشه‌های روی آن (glass / glass-bronze) همین نورها و تصویر را تار و رنگی می‌کنند.
 * `dim` میزان تیرگی را عوض می‌کند: صفحهٔ خانه روشن‌تر، صفحه‌های پرمتن تیره‌تر.
 */
export function KioskBackdrop({ dim = "normal" }: { dim?: "soft" | "normal" | "deep" }) {
  const scrim = {
    soft: "linear-gradient(180deg, rgba(3,8,15,0.30) 0%, rgba(3,8,15,0.46) 50%, rgba(3,8,15,0.78) 100%)",
    normal:
      "linear-gradient(180deg, rgba(3,8,15,0.42) 0%, rgba(3,8,15,0.58) 50%, rgba(3,8,15,0.84) 100%)",
    deep: "linear-gradient(180deg, rgba(3,8,15,0.56) 0%, rgba(3,8,15,0.72) 50%, rgba(3,8,15,0.92) 100%)",
  }[dim];

  return (
    <>
      <div
        className="fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${museumBg})` }}
        aria-hidden
      />
      <div className="fixed inset-0 z-0" style={{ background: scrim }} aria-hidden />
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
        <span className="liquid-orb liquid-orb-bronze" />
        <span className="liquid-orb liquid-orb-teal" />
        <span className="liquid-orb liquid-orb-violet" />
      </div>
    </>
  );
}
