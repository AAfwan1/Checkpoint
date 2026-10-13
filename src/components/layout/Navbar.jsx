
"use client";

import Image from "next/image";
import { useState } from "react";
import {
  FiMenu,
  FiX,
  FiArrowUpRight,
  FiCalendar,
  FiActivity,
  FiMonitor,
  FiCoffee,
  FiMapPin,
  FiGrid,
} from "react-icons/fi";

const links = [
  { name: "Booking", href: "/booking", icon: FiCalendar },
  { name: "Gaming", href: "/#gaming", icon: FiMonitor },
  { name: "Fitness", href: "/#packages", icon: FiActivity },
  { name: "Restaurant", href: "/#restaurant", icon: FiCoffee },
  { name: "Gallery", href: "/#gallery", icon: FiGrid },
  { name: "Contact & Location", href: "/#contact", icon: FiMapPin },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 px-4 pt-4 sm:px-6">
      <nav className="mx-auto max-w-7xl rounded-2xl border border-white/10 bg-[#07101c]/80 shadow-2xl backdrop-blur-xl">
        <div className="flex h-[68px] items-center justify-between px-5 sm:px-7">
          <a
            href="/"
            onClick={() => setOpen(false)}
            aria-label="The Checkpoint Home"
            className="flex shrink-0 items-center gap-3"
          >
            <Image
              src="/logo.webp"
              alt="The Checkpoint Logo"
              width={40}
              height={40}
              priority
              className="rounded-lg object-cover"
            />
            <div className="leading-none">
              <span className="block text-[15px] font-black tracking-[0.08em] text-white">
                THE CHECKPOINT
              </span>
              <span className="mt-1 block text-[7px] font-medium tracking-[0.3em] text-slate-500">
                GAMING · DINING · FITNESS
              </span>
            </div>
          </a>

          <div className="hidden items-center gap-1 xl:flex">
            {links.map(({ name, href, icon: Icon }) => (
              <a
                key={name}
                href={href}
                className="flex items-center rounded-lg px-2.5 py-2.5 text-[13px] font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                <Icon size={13} className="mr-1.5 text-blue-400" />
                {name}
              </a>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06] xl:hidden"
          >
            {open ? <FiX size={22} /> : <FiMenu size={22} />}
          </button>
        </div>

        <div
          className={`overflow-hidden border-t px-5 transition-[max-height,opacity] duration-200 xl:hidden ${
            open
              ? "max-h-[400px] border-white/10 pb-5 pt-3 opacity-100"
              : "max-h-0 border-t-transparent pb-0 pt-0 opacity-0"
          }`}
        >
          <div className="flex flex-col">
            {links.map(({ name, href, icon: Icon }) => (
              <a
                key={name}
                href={href}
                onClick={() => setOpen(false)}
                className="group flex items-center rounded-lg px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
              >
                <Icon size={15} className="mr-3 text-blue-400" />
                {name}
                <FiArrowUpRight
                  size={14}
                  className="ml-auto text-white/20"
                />
              </a>
            ))}
          </div>
        </div>
      </nav>
    </header>
  );
}
