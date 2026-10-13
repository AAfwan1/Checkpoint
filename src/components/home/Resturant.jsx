
"use client";

import Image from "next/image";
import { useState } from "react";
import { FiArrowUpRight, FiX } from "react-icons/fi";
import { resturant } from "@/generated/gallery-data";

export default function Restaurant() {
  const [selectedMenu, setSelectedMenu] = useState(null);
  const menuImages = resturant?.images ?? [];

  return (
    <section id="restaurant" className="bg-[#030712] text-white">
      <div className="mx-auto max-w-7xl px-5 py-1 sm:px-8 sm:py-28 lg:px-10">
        <header className="mt-12 mb-10 flex items-end justify-between sm:mt-16">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-blue-400">
              Checkpoint Restaurant
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
              Food and Drinks Menus
            </h2>
          </div>
          <span className="hidden text-[9px] uppercase tracking-[0.2em] text-white/30 sm:block">
            Tap to view
          </span>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {menuImages.map((src, index) => {
            const title = ["FOOD MENU", "DRINKS MENU"][index] ?? `MENU ${index + 1}`;

            return (
              <button
                key={src}
                type="button"
                onClick={() => setSelectedMenu({ src, title })}
                aria-label={`View ${title.toLowerCase()}`}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#07101D] text-left"
              >
                <div className="relative aspect-[4/5]">
                  <Image
                    src={src}
                    alt={`${title} - The Checkpoint Bashundhara`}
                    fill
                    sizes="(max-width: 639px) 100vw, 50vw"
                    quality={70}
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                  <div className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition group-hover:bg-blue-600">
                    <FiArrowUpRight size={17} />
                  </div>
                  <div className="absolute bottom-0 left-0 p-5 sm:p-7">
                    <p className="text-[8px] font-bold tracking-[0.3em] text-blue-300">
                      THE CHECKPOINT
                    </p>
                    <h3 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
                      {title}
                    </h3>
                    <p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-white/50">
                      Tap to view
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedMenu && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-3 sm:p-4"
          onClick={() => setSelectedMenu(null)}
        >
          <button
            type="button"
            onClick={() => setSelectedMenu(null)}
            aria-label="Close menu"
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/80 text-white hover:bg-blue-600 sm:right-4 sm:top-4"
          >
            <FiX size={20} />
          </button>

          <div
            className="relative max-h-[94dvh] w-[94vw] max-w-5xl overflow-auto rounded-xl border border-white/10 bg-[#030712]"
            onClick={(event) => event.stopPropagation()}
          >
            <Image
              src={selectedMenu.src}
              alt={selectedMenu.title}
              width={1024}
              height={1280}
              sizes="94vw"
              quality={75}
              className="block h-auto w-full"
            />
          </div>
        </div>
      )}
    </section>
  );
}
