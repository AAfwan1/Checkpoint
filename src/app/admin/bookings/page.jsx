"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FiAlertTriangle,
  FiCalendar,
  FiChevronDown,
  FiClock,
  FiEdit2,
  FiEye,
  FiFilter,
  FiRefreshCw,
  FiSearch,
  FiTrash2,
  FiUsers,
  FiX,
} from "react-icons/fi";

const FACILITIES = [
  "All Facilities",
  "Gym",
  "Swimming Pool",
  "Gym + Pool",
  "Steam Bath",
  "Playground",
  "Private Movie",
];

const STATUSES = [
  "All Statuses",
  "Pending",
  "Confirmed",
  "Completed",
  "Cancelled",
];

const PAYMENT_STATUSES = [
  "All Payments",
  "Unpaid",
  "Pending",
  "Paid",
  "Failed",
  "Refunded",
];

const AUTO_REFRESH_MS = 10000;

function formatDate(date) {
  if (!date) return "—";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatDateInput(date) {
  if (!date) return "";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return "";

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatTime(time) {
  if (!time || time === "Anytime") return time || "—";

  const match = time.match(/^(\d{2}):(\d{2})$/);

  if (!match) return time;

  const hour = Number(match[1]);
  const minute = match[2];
  const period = hour >= 12 ? "PM" : "AM";

  return `${hour % 12 || 12}:${minute} ${period}`;
}

function formatTimeRange(startTime, endTime) {
  if (!startTime) return "Anytime";
  if (!endTime) return formatTime(startTime);

  return `${formatTime(startTime)} – ${formatTime(endTime)}`;
}

function formatDuration(minutes) {
  if (!minutes || minutes < 1) return "—";

  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  if (minutes < 60) return `${minutes} minutes`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}h ${remainingMinutes}m`;
}

function formatCurrency(amount) {
  const value = Number(amount);

  if (!Number.isFinite(value)) return "৳0";

  return `৳${value.toLocaleString("en-BD")}`;
}

function normalizeStatus(status) {
  if (!status) return "Pending";

  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function normalizePaymentStatus(status) {
  if (!status) return "Unpaid";

  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function getStatusClasses(status) {
  switch (status) {
    case "Confirmed":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
    case "Completed":
      return "border-blue-400/20 bg-blue-400/10 text-blue-300";
    case "Cancelled":
      return "border-red-400/20 bg-red-400/10 text-red-300";
    case "Pending":
      return "border-amber-400/20 bg-amber-400/10 text-amber-300";
    default:
      return "border-white/10 bg-white/5 text-white/50";
  }
}

function getPaymentClasses(payment) {
  switch (payment) {
    case "Paid":
      return "text-emerald-400/80";
    case "Pending":
      return "text-amber-400/80";
    case "Failed":
      return "text-red-400/80";
    case "Refunded":
      return "text-blue-400/80";
    default:
      return "text-white/35";
  }
}

function FilterSelect({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#07101D] pl-4 pr-10 text-sm text-white/70 outline-none transition focus:border-blue-400/30"
      >
        {options.map((option) => (
          <option
            key={option}
            value={option}
            className="bg-[#07101D] text-white"
          >
            {option}
          </option>
        ))}
      </select>

      <FiChevronDown
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/30"
      />
    </div>
  );
}

function normalizeBooking(booking) {
  return {
    id: booking.id || booking._id || "",
    bookingReference: booking.bookingReference || "",
    bookingGroupReference: booking.bookingGroupReference || "",
    customer: booking.customer?.name || "Unknown customer",
    email: booking.customer?.email || "",
    phone: booking.customer?.phone || "",
    service: booking.service?.name || "Unknown service",
    facility: booking.facility?.name || "Unknown facility",
    date: formatDateInput(booking.bookingDate),
    startTime: booking.startTime || "",
    time: formatTimeRange(booking.startTime, booking.endTime),
    duration: formatDuration(booking.durationMinutes),
    guests: Number(booking.quantity) || 0,
    amount: Number(booking.totalAmount) || 0,
    movieName: booking.movieName || "",
    status: normalizeStatus(booking.status),
    payment: normalizePaymentStatus(booking.paymentStatus),
    paymentTransactionId: booking.paymentTransactionId || "",
    paymentMethod: booking.paymentMethod || "",
    checkedIn: Boolean(booking.checkedIn),
    checkedOut: Boolean(booking.checkedOut),
    createdAt: booking.createdAt || null,
  };
}

function canReschedule(booking) {
  return (
    booking.status === "Confirmed" &&
    booking.payment === "Paid" &&
    !booking.checkedIn &&
    !booking.checkedOut
  );
}

export default function AdminBookingsPage() {
  const [search, setSearch] = useState("");
  const [facility, setFacility] = useState("All Facilities");
  const [status, setStatus] = useState("All Statuses");
  const [paymentStatus, setPaymentStatus] = useState("All Payments");
  const [date, setDate] = useState("");

  const [bookings, setBookings] = useState([]);
  const [selectedBooking, setSelectedBooking] = useState(null);

  const [bookingToDelete, setBookingToDelete] = useState(null);
  const [deletingBooking, setDeletingBooking] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [rescheduleBooking, setRescheduleBooking] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchBookings = useCallback(
    async ({ silent = false, signal } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("limit", "100");

        if (search.trim()) params.set("search", search.trim());

        if (status !== "All Statuses") {
          params.set("status", status.toLowerCase());
        }

        if (paymentStatus !== "All Payments") {
          params.set("paymentStatus", paymentStatus.toLowerCase());
        }

        if (date) params.set("date", date);

        const response = await fetch(
          `/api/bookings/admin?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            signal,
          }
        );

        let data;

        try {
          data = await response.json();
        } catch {
          throw new Error("Invalid response from the bookings API.");
        }

        if (!response.ok || !data?.success) {
          throw new Error(data?.error || "Unable to load bookings.");
        }

        const normalizedBookings = Array.isArray(data.data)
          ? data.data.map(normalizeBooking)
          : [];

        setBookings(normalizedBookings);
        setLastUpdated(new Date());
      } catch (fetchError) {
        if (fetchError?.name === "AbortError") return;

        console.error("Admin booking fetch error:", fetchError);
        setError(fetchError?.message || "Unable to load bookings.");
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [date, paymentStatus, search, status]
  );

  useEffect(() => {
    const controller = new AbortController();

    fetchBookings({
      silent: false,
      signal: controller.signal,
    });

    return () => controller.abort();
  }, [fetchBookings]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchBookings({ silent: true });
    }, AUTO_REFRESH_MS);

    return () => clearInterval(interval);
  }, [fetchBookings]);

  const filteredBookings = useMemo(() => {
    if (facility === "All Facilities") return bookings;

    return bookings.filter((booking) => booking.facility === facility);
  }, [bookings, facility]);

  const totalRevenue = useMemo(
    () =>
      filteredBookings.reduce(
        (total, booking) => total + booking.amount,
        0
      ),
    [filteredBookings]
  );

  const confirmedCount = useMemo(
    () =>
      filteredBookings.filter(
        (booking) => booking.status === "Confirmed"
      ).length,
    [filteredBookings]
  );

  const pendingCount = useMemo(
    () =>
      filteredBookings.filter(
        (booking) => booking.status === "Pending"
      ).length,
    [filteredBookings]
  );

  const handleRefresh = () => {
    if (!refreshing) fetchBookings({ silent: true });
  };

  // Open the reschedule modal.
  const openRescheduleModal = (booking) => {
    if (!canReschedule(booking)) return;

    setRescheduleError("");
    setRescheduleBooking(booking);
    setRescheduleDate(booking.date || "");
    setRescheduleTime(booking.startTime || "");
  };

  const closeRescheduleModal = () => {
    if (rescheduling) return;

    setRescheduleBooking(null);
    setRescheduleDate("");
    setRescheduleTime("");
    setRescheduleError("");
  };

  // Submit the new date and time to the reschedule API.
  const handleRescheduleBooking = async (event) => {
    event.preventDefault();

    if (!rescheduleBooking?.id || rescheduling) return;

    if (!rescheduleDate || !rescheduleTime) {
      setRescheduleError("Please select a date and start time.");
      return;
    }

    try {
      setRescheduling(true);
      setRescheduleError("");

      const response = await fetch("/api/bookings/admin/reschedule", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingId: rescheduleBooking.id,
          date: rescheduleDate,
          startTime: rescheduleTime,
        }),
      });

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error("Invalid response from the reschedule API.");
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || data?.message || "Unable to reschedule booking."
        );
      }

      const updatedBookingId = rescheduleBooking.id;

      setRescheduleBooking(null);
      setRescheduleDate("");
      setRescheduleTime("");
      setSelectedBooking((current) =>
        current?.id === updatedBookingId ? null : current
      );

      await fetchBookings({ silent: true });
    } catch (rescheduleRequestError) {
      console.error(
        "Admin booking reschedule error:",
        rescheduleRequestError
      );

      setRescheduleError(
        rescheduleRequestError?.message ||
          "Unable to reschedule booking."
      );
    } finally {
      setRescheduling(false);
    }
  };

  const handleDeleteBooking = async () => {
    if (!bookingToDelete?.id || deletingBooking) return;

    try {
      setDeletingBooking(true);
      setDeleteError("");

      const response = await fetch(
        `/api/bookings/admin?id=${encodeURIComponent(bookingToDelete.id)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error("Invalid response from the delete API.");
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || data?.message || "Unable to delete booking."
        );
      }

      setBookings((current) =>
        current.filter((booking) => booking.id !== bookingToDelete.id)
      );

      setSelectedBooking((current) =>
        current?.id === bookingToDelete.id ? null : current
      );

      setBookingToDelete(null);
      setLastUpdated(new Date());
    } catch (deleteRequestError) {
      console.error("Admin booking delete error:", deleteRequestError);

      setDeleteError(
        deleteRequestError?.message || "Unable to delete booking."
      );
    } finally {
      setDeletingBooking(false);
    }
  };

  const resetFilters = () => {
    setSearch("");
    setFacility("All Facilities");
    setStatus("All Statuses");
    setPaymentStatus("All Payments");
    setDate("");
  };

  if (loading && bookings.length === 0) {
    return (
      <div className="min-h-screen bg-[#050A14]">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <header className="mb-8">
            <Link
              href="/admin"
              className="mb-3 inline-flex items-center text-xs font-medium text-white/35 transition hover:text-blue-400"
            >
              ← Dashboard
            </Link>

            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-400">
              Booking Management
            </p>

            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Bookings
            </h1>

            <p className="mt-2 text-sm text-white/40">
              Loading customer bookings...
            </p>
          </header>

          <div className="rounded-2xl border border-white/10 bg-[#07101D] p-8">
            <div className="flex min-h-[300px] flex-col items-center justify-center">
              <FiRefreshCw
                size={25}
                className="animate-spin text-blue-400"
              />
              <p className="mt-4 text-sm text-white/50">
                Loading bookings...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050A14]">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/admin"
              className="mb-3 inline-flex items-center text-xs font-medium text-white/35 transition hover:text-blue-400"
            >
              ← Dashboard
            </Link>

            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-400">
              Booking Management
            </p>

            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Bookings
            </h1>

            <p className="mt-2 text-sm text-white/40">
              View and manage all customer bookings.
            </p>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white/70 transition hover:border-blue-400/20 hover:bg-blue-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FiRefreshCw
              size={15}
              className={refreshing ? "animate-spin" : ""}
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        {error && (
          <section className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-red-300">
                  Unable to load bookings
                </p>
                <p className="mt-1 text-xs text-red-300/60">{error}</p>
              </div>

              <button
                type="button"
                onClick={handleRefresh}
                className="w-fit rounded-lg border border-red-400/20 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-400/10"
              >
                Try Again
              </button>
            </div>
          </section>
        )}

        {/* Summary cards */}
        <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-[#07101D] p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Confirmed
              </p>
              <FiUsers className="text-emerald-400" size={18} />
            </div>

            <p className="mt-3 text-3xl font-semibold text-white">
              {confirmedCount}
            </p>

            <p className="mt-1 text-xs text-white/30">
              Active confirmed bookings
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#07101D] p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Booking Value
              </p>
              <span className="text-sm font-semibold text-blue-400">৳</span>
            </div>

            <p className="mt-3 text-3xl font-semibold text-white">
              {formatCurrency(totalRevenue)}
            </p>

            <p className="mt-1 text-xs text-white/30">
              Total value of results
            </p>
          </div>
        </section>

        {/* Filters */}
        <section className="mb-6 rounded-2xl border border-white/10 bg-[#07101D] p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <FiFilter size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Filters</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_180px_160px_160px_180px_auto]">
            <div className="relative">
              <FiSearch
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25"
              />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customer, booking ID, service..."
                className="h-11 w-full rounded-xl border border-white/10 bg-[#050A14] pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-blue-400/30"
              />
            </div>

            <FilterSelect
              value={facility}
              onChange={setFacility}
              options={FACILITIES}
            />

            <FilterSelect
              value={status}
              onChange={setStatus}
              options={STATUSES}
            />

            <FilterSelect
              value={paymentStatus}
              onChange={setPaymentStatus}
              options={PAYMENT_STATUSES}
            />

            <div className="relative">
              <FiCalendar
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25"
              />
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-11 w-full rounded-xl border border-white/10 bg-[#07101D] pl-10 pr-3 text-sm text-white/70 outline-none transition focus:border-blue-400/30"
              />
            </div>

            <button
              type="button"
              onClick={resetFilters}
              className="h-11 rounded-xl border border-white/10 bg-white/[0.03] px-5 text-sm font-medium text-white/50 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
            >
              Reset
            </button>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>

            <span className="text-xs text-white/35">
              Live booking updates enabled
            </span>

            {pendingCount > 0 && (
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                {pendingCount} pending
              </span>
            )}
          </div>

          {lastUpdated && (
            <p className="text-xs text-white/25">
              Updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Bookings table */}
        <section className="rounded-2xl border border-white/10 bg-[#07101D] p-5 sm:p-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-white">
                All Bookings
              </h2>
              <p className="mt-1 text-sm text-white/40">
                {filteredBookings.length} booking
                {filteredBookings.length !== 1 ? "s" : ""} found
              </p>
            </div>

            <p className="text-xs text-white/25">
              Auto-refreshes every 10 seconds
            </p>
          </div>

          {filteredBookings.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-6 text-center">
              <FiCalendar size={28} className="text-white/20" />

              <h3 className="mt-4 text-sm font-semibold text-white">
                No bookings found
              </h3>

              <p className="mt-1 max-w-sm text-xs leading-5 text-white/35">
                Try changing your search or filters to find the booking you
                are looking for.
              </p>

              <button
                type="button"
                onClick={resetFilters}
                className="mt-5 rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-white/60 transition hover:border-blue-400/20 hover:text-white"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1100px]">
                <div className="grid grid-cols-[125px_minmax(170px,1.2fr)_minmax(190px,1.4fr)_175px_80px_125px_112px] gap-4 border-b border-white/10 px-3 pb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                  <span>Booking ID</span>
                  <span>Customer</span>
                  <span>Service</span>
                  <span>Date & Time</span>
                  <span>Guests</span>
                  <span>Amount</span>
                  <span />
                </div>

                <div className="divide-y divide-white/[0.06]">
                  {filteredBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="grid grid-cols-[125px_minmax(170px,1.2fr)_minmax(190px,1.4fr)_175px_80px_125px_112px] items-center gap-4 px-3 py-4 transition hover:bg-white/[0.015]"
                    >
                      <div>
                        <span className="text-xs font-semibold text-blue-400">
                          #{booking.bookingReference || booking.id}
                        </span>

                        {booking.status === "Pending" && (
                          <span className="mt-1 block text-[9px] uppercase tracking-wider text-amber-400/60">
                            New
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white/80">
                          {booking.customer}
                        </p>
                        <p className="mt-1 truncate text-[11px] text-white/30">
                          {booking.phone}
                        </p>
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/70">
                          {booking.service}
                        </p>
                        <p className="mt-1 truncate text-[11px] text-white/30">
                          {booking.facility}
                        </p>
                      </div>

                      <div>
                        <p className="text-sm text-white/65">
                          {formatDate(booking.date)}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-white/30">
                          <FiClock size={11} />
                          {booking.time}
                        </p>
                      </div>

                      <span className="text-sm text-white/60">
                        {booking.guests}
                      </span>

                      <div>
                        <p className="text-sm font-medium text-white/75">
                          {formatCurrency(booking.amount)}
                        </p>
                        <p
                          className={`mt-1 text-[10px] ${getPaymentClasses(
                            booking.payment
                          )}`}
                        >
                          {booking.payment}
                        </p>
                      </div>

                      <div className="flex justify-end gap-1">
                        {canReschedule(booking) && (
                          <button
                            type="button"
                            onClick={() => openRescheduleModal(booking)}
                            aria-label={`Reschedule ${booking.bookingReference || booking.id}`}
                            title="Reschedule booking"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-400/15 bg-blue-400/[0.04] text-blue-300/70 transition hover:border-blue-400/40 hover:bg-blue-400/10 hover:text-blue-300"
                          >
                            <FiEdit2 size={15} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setSelectedBooking(booking)}
                          aria-label={`View ${booking.bookingReference || booking.id}`}
                          title="View booking"
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.02] text-white/35 transition hover:border-blue-400/20 hover:bg-blue-500/10 hover:text-blue-400"
                        >
                          <FiEye size={15} />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError("");
                            setBookingToDelete(booking);
                          }}
                          aria-label={`Delete ${booking.bookingReference || booking.id}`}
                          title="Permanently delete booking"
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-400/15 bg-red-400/[0.04] text-red-300/70 transition hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
                        >
                          <FiTrash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Booking details modal */}
      {selectedBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedBooking(null);
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#07101D] shadow-2xl">
            <div className="flex items-start justify-between border-b border-white/10 p-5 sm:p-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-400">
                  Booking Details
                </p>

                <h2 className="mt-2 text-xl font-semibold text-white">
                  #{selectedBooking.bookingReference || selectedBooking.id}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setSelectedBooking(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/30 transition hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                <FiX size={16} />
              </button>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                  Customer
                </p>
                <p className="mt-2 text-sm font-medium text-white">
                  {selectedBooking.customer}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  {selectedBooking.email}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  {selectedBooking.phone}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Facility
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    {selectedBooking.facility}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Service
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    {selectedBooking.service}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Date
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    {formatDate(selectedBooking.date)}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Time
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    {selectedBooking.time}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Duration
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    {selectedBooking.duration}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Guests
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    {selectedBooking.guests}
                  </p>
                </div>
              </div>

              {selectedBooking.movieName && (
                <div className="border-t border-white/10 pt-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Movie
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    {selectedBooking.movieName}
                  </p>
                </div>
              )}

              <div className="border-t border-white/10 pt-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                  Booking Group
                </p>
                <p className="mt-2 break-all font-mono text-[11px] text-white/45">
                  {selectedBooking.bookingGroupReference || "—"}
                </p>
              </div>

              <div className="border-t border-white/10 pt-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                  Payment
                </p>

                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-white/25">Status</p>
                    <p
                      className={`mt-1 text-sm ${getPaymentClasses(
                        selectedBooking.payment
                      )}`}
                    >
                      {selectedBooking.payment}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] text-white/25">Method</p>
                    <p className="mt-1 text-sm text-white/60">
                      {selectedBooking.paymentMethod || "—"}
                    </p>
                  </div>
                </div>

                {selectedBooking.paymentTransactionId && (
                  <div className="mt-4">
                    <p className="text-[10px] text-white/25">
                      Transaction ID
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] text-white/40">
                      {selectedBooking.paymentTransactionId}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Amount
                  </p>
                  <p className="mt-1 text-xl font-semibold text-white">
                    {formatCurrency(selectedBooking.amount)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${getStatusClasses(
                      selectedBooking.status
                    )}`}
                  >
                    {selectedBooking.status}
                  </span>

                  <span
                    className={`rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-semibold ${getPaymentClasses(
                      selectedBooking.payment
                    )}`}
                  >
                    {selectedBooking.payment}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Check-in
                  </p>
                  <p className="mt-2 text-sm text-white/60">
                    {selectedBooking.checkedIn
                      ? "Checked in"
                      : "Not checked in"}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Check-out
                  </p>
                  <p className="mt-2 text-sm text-white/60">
                    {selectedBooking.checkedOut
                      ? "Checked out"
                      : "Not checked out"}
                  </p>
                </div>
              </div>

              {selectedBooking.createdAt && (
                <div className="border-t border-white/10 pt-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">
                    Created
                  </p>
                  <p className="mt-2 text-xs text-white/40">
                    {new Date(selectedBooking.createdAt).toLocaleString()}
                  </p>
                </div>
              )}

              {canReschedule(selectedBooking) && (
                <div className="border-t border-white/10 pt-5">
                  <button
                    type="button"
                    onClick={() => {
                      const booking = selectedBooking;
                      setSelectedBooking(null);
                      openRescheduleModal(booking);
                    }}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 text-sm font-medium text-blue-300 transition hover:border-blue-400/40 hover:bg-blue-500/15"
                  >
                    <FiEdit2 size={15} />
                    Reschedule Booking
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reschedule booking modal */}
      {rescheduleBooking && (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !rescheduling
            ) {
              closeRescheduleModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reschedule-booking-title"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#07101D] shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-white/10 p-5 sm:p-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-400">
                  Booking Management
                </p>

                <h2
                  id="reschedule-booking-title"
                  className="mt-2 text-xl font-semibold text-white"
                >
                  Reschedule Booking
                </h2>

                <p className="mt-1 text-xs text-white/40">
                  #{rescheduleBooking.bookingReference || rescheduleBooking.id}
                </p>
              </div>

              <button
                type="button"
                disabled={rescheduling}
                onClick={closeRescheduleModal}
                aria-label="Close reschedule modal"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/30 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
              >
                <FiX size={16} />
              </button>
            </div>

            <form
              onSubmit={handleRescheduleBooking}
              className="space-y-5 p-5 sm:p-6"
            >
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="text-xs font-medium text-white/75">
                  {rescheduleBooking.customer}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  {rescheduleBooking.service} · {rescheduleBooking.facility}
                </p>
                <p className="mt-1 text-xs text-white/40">
                  Current schedule: {formatDate(rescheduleBooking.date)} ·{" "}
                  {rescheduleBooking.time}
                </p>
              </div>

              <div>
                <label
                  htmlFor="reschedule-date"
                  className="mb-2 block text-xs font-medium text-white/60"
                >
                  New date
                </label>

                <input
                  id="reschedule-date"
                  type="date"
                  required
                  value={rescheduleDate}
                  onChange={(event) =>
                    setRescheduleDate(event.target.value)
                  }
                  disabled={rescheduling}
                  className="h-11 w-full [&::-webkit-calendar-picker-indicator]:invert rounded-xl border border-white/10 bg-[#050A14] px-3 text-sm text-white outline-none transition focus:border-blue-400/40 disabled:opacity-50"
                />
              </div>

              <div>
                <label
                  htmlFor="reschedule-time"
                  className="mb-2 block text-xs font-medium text-white/60"
                >
                  New start time
                </label>

                <input
                  id="reschedule-time"
                  type="time"
                  required
                  value={rescheduleTime}
                  onChange={(event) =>
                    setRescheduleTime(event.target.value)
                  }
                  disabled={rescheduling}
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#050A14] px-3 text-sm text-white outline-none transition focus:border-blue-400/40 disabled:opacity-50 [&::-webkit-calendar-picker-indicator]:invert"
                />
              </div>

              <p className="text-xs leading-5 text-white/35">
                The booking will keep its existing payment and price. The
                new date and time will be checked against availability.
              </p>

              {rescheduleError && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-sm text-red-300">
                  {rescheduleError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={rescheduling}
                  onClick={closeRescheduleModal}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white/65 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    rescheduling || !rescheduleDate || !rescheduleTime
                  }
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/15 px-4 text-sm font-semibold text-blue-200 transition hover:border-blue-400/40 hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rescheduling ? (
                    <>
                      <FiRefreshCw size={14} className="animate-spin" />
                      Rescheduling...
                    </>
                  ) : (
                    <>
                      <FiEdit2 size={14} />
                      Confirm Reschedule
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permanent booking deletion confirmation */}
      {bookingToDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !deletingBooking
            ) {
              setBookingToDelete(null);
              setDeleteError("");
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-booking-title"
            aria-describedby="delete-booking-description"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-red-400/20 bg-[#07101D] shadow-2xl shadow-black/40"
          >
            <div className="flex items-start gap-4 border-b border-white/[0.07] p-5 sm:p-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-300">
                <FiAlertTriangle size={20} />
              </div>

              <div className="min-w-0 flex-1">
                <h2
                  id="delete-booking-title"
                  className="text-base font-semibold text-white"
                >
                  Permanently delete booking?
                </h2>

                <p
                  id="delete-booking-description"
                  className="mt-2 text-sm leading-6 text-white/50"
                >
                  This permanently removes booking{" "}
                  <span className="font-semibold text-white/80">
                    #
                    {bookingToDelete.bookingReference || bookingToDelete.id}
                  </span>{" "}
                  from the database. This action cannot be undone.
                </p>
              </div>

              <button
                type="button"
                disabled={deletingBooking}
                onClick={() => {
                  setBookingToDelete(null);
                  setDeleteError("");
                }}
                aria-label="Close delete confirmation"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/35 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FiX size={16} />
              </button>
            </div>

            <div className="space-y-4 p-5 sm:p-6">
              <div className="rounded-xl border border-red-400/10 bg-red-400/[0.04] p-3">
                <p className="text-xs leading-5 text-red-200/75">
                  Associated payment records may also be permanently
                  deleted. No refund will be issued.
                </p>
              </div>

              {deleteError && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-sm text-red-300">
                  {deleteError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={deletingBooking}
                  onClick={() => {
                    setBookingToDelete(null);
                    setDeleteError("");
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white/65 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Keep booking
                </button>

                <button
                  type="button"
                  disabled={deletingBooking}
                  onClick={handleDeleteBooking}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-500/15 px-4 text-sm font-semibold text-red-200 transition hover:border-red-400/40 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingBooking ? (
                    <>
                      <FiRefreshCw size={14} className="animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <FiTrash2 size={14} />
                      Delete permanently
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}