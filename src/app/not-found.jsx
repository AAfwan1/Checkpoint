
import Link from "next/link";
import { FiArrowLeft, FiArrowUpRight, FiAlertTriangle } from "react-icons/fi";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#030712] px-6 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.5)_1px,transparent_1px)] [background-size:60px_60px]" />

      <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
        <Link href="/" className="mb-10 inline-flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
            <span className="text-xl font-black italic">C</span>
          </span>

          <span className="text-left leading-none">
            <span className="block text-[15px] font-black tracking-[0.08em]">
              THE CHECKPOINT
            </span>
            <span className="mt-1 block text-[7px] tracking-[0.3em] text-slate-500">
              GAMING · DINING · FITNESS
            </span>
          </span>
        </Link>

        <div className="mb-5 flex items-center justify-center gap-3 text-blue-400">
          <FiAlertTriangle size={13} />
          <span className="text-[10px] font-bold uppercase tracking-[0.35em]">
            System Error
          </span>
          <FiAlertTriangle size={13} />
        </div>

        <h1 className="text-[clamp(8rem,25vw,16rem)] font-black leading-[0.7] tracking-[-0.09em]">
          4<span className="text-blue-500">0</span>4
        </h1>

        <h2 className="mt-10 text-2xl font-black tracking-tight sm:text-3xl">
          YOU LEFT THE ARENA.
        </h2>

        <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-slate-500">
          Looks like this page doesn't exist. Maybe you took a wrong turn
          between the gaming zone and the restaurant.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-xl bg-blue-600 px-6 py-4 text-xs font-black tracking-wide transition-colors hover:bg-blue-500"
          >
            <FiArrowLeft size={15} />
            BACK TO HOME
          </Link>

          <Link
            href="/#experience"
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-4 text-xs font-bold tracking-wide text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
          >
            EXPLORE CHECKPOINT
            <FiArrowUpRight size={15} />
          </Link>
        </div>

        <div className="mx-auto mt-14 flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/[0.02] px-4 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          <FiArrowUpRight size={13} className="text-white/30" />
          <span className="text-[9px] font-bold tracking-[0.2em] text-white/30">
            CHECKPOINT ONLINE
          </span>
        </div>
      </div>
    </main>
  );
}
