
"use client";

import Image from "next/image";
import { useState } from "react";
import { FiX, FiMaximize2 } from "react-icons/fi";
import { gallerySections } from "@/generated/gallery-data";

export default function Gallery() {
  const [selectedImage, setSelectedImage] = useState(null);

  return (
    <>
      <section
        id="gallery"
        className="bg-[#030712] px-4 py-20 text-white sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-7xl">
          <header className="mb-12 text-center">
            <p className="mb-3 text-sm font-medium uppercase tracking-[0.25em] text-blue-400">
              Explore The Checkpoint Gallery
            </p>

            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              See What Awaits You
            </h2>
          </header>

          <div className="space-y-16">
            {gallerySections.map((section) => (
              <div key={section.folder} className="space-y-12">
                {section.routes.map((route) => (
                  <div key={route.folder}>
                    <h3 className="pb-10 text-xl font-black uppercase tracking-[0.1em] text-blue-400 sm:text-2xl">
                      {route.folder
                        .replace(/-/g, " ")
                        .replace(/\b\w/g, (char) => char.toUpperCase())}
                    </h3>

                    <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:gap-4">
                      {route.images.map((image, index) => (
                        <button
                          key={image}
                          type="button"
                          onClick={() =>
                            setSelectedImage({
                              src: image,
                              title: route.folder,
                            })
                          }
                          aria-label={`View ${route.folder} image ${index + 1}`}
                          className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-[#080f1c] focus:outline-none focus:ring-2 focus:ring-blue-500/60 sm:rounded-xl"
                        >
                          <Image
                            src={image}
                            alt={`${route.folder} ${index + 1}`}
                            fill
                            sizes="(max-width: 640px) 33vw, (max-width: 1024px) 30vw, 400px"
                            quality={70}
                            className="object-cover"
                          />

                          <div className="pointer-events-none absolute inset-0 transition-colors sm:group-hover:bg-black/25" />

                          <div className="pointer-events-none absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full bg-black/50 sm:flex sm:opacity-0 sm:group-hover:opacity-100">
                            <FiMaximize2 size={13} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {selectedImage && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 p-3 sm:p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            type="button"
            onClick={() => setSelectedImage(null)}
            aria-label="Close image"
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/70 transition-colors hover:bg-white/10 sm:right-4 sm:top-4"
          >
            <FiX size={22} />
          </button>

          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl items-center justify-center overflow-auto rounded-xl border border-white/10 bg-[#080f1c]"
            onClick={(event) => event.stopPropagation()}
          >
            <Image
              src={selectedImage.src}
              alt={selectedImage.title}
              width={1600}
              height={1200}
              sizes="(max-width: 640px) 94vw, 1200px"
              quality={75}
              className="block h-auto max-h-[90vh] w-auto max-w-[94vw] object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
