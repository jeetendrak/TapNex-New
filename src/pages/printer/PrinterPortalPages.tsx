import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, Printer, Truck, Wifi, FileText, Image as ImageIcon } from 'lucide-react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { PortalLayout } from '../../components/PortalLayout';
import { CardCanvasPreview } from '../../components/CardCanvasPreview';
import { FulfilmentTimeline } from '../../components/FulfilmentTimeline';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { db } from '../../lib/firebase';
import {
  getCardDesignById,
  getOrderById,
  getPrinterOrders,
  getPublicProfileBySlug,
  getQrCodeById,
  sendAndLogTransactionalEmail,
} from '../../lib/firestoreService';
import { createServerShippingRecord, updateServerOrderStatus } from '../../lib/paymentApi';
import { formatFirestoreErrorMessage } from '../../lib/cardDesignSize';
import { executeTimelineStatusUpdate } from '../../lib/timelineFeedback';
import {
  buildDispatchedEmailVariables,
  executeDispatchWithNotification,
  executeRetryDispatchEmail,
  formatEmailDeliveryFailureReason,
} from '../../lib/dispatchEmailFeedback';
import { downloadBlob, generateCardSidePngBlob, generatePrintReadyPdfBlob } from '../../lib/printPdf';
import type {
  CardDesignRecord,
  OrderRecord,
  OrderStatus,
  PersonalInformation,
  PrinterRecord,
  PublicProfileRecord,
  QrCodeRecord,
} from '../../types';

export const PrinterDashboardPage: React.FC = () => {
  const { userRecord } = useAuth();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userRecord) return;
    getPrinterOrders(userRecord.uid)
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [userRecord]);

  const stats = [
    { label: 'Total Assigned Orders', value: orders.length },
    { label: 'Pending Production', value: orders.filter((o) => ['Assigned to Printer', 'Processing'].includes(o.orderStatus)).length },
    { label: 'Printing in Progress', value: orders.filter((o) => o.orderStatus === 'Printing in Progress').length },
    { label: 'Ready for Dispatch', value: orders.filter((o) => o.orderStatus === 'Ready for Dispatch').length },
    { label: 'Dispatched', value: orders.filter((o) => ['Dispatched', 'In Transit'].includes(o.orderStatus)).length },
    { label: 'Completed / Delivered', value: orders.filter((o) => o.orderStatus === 'Delivered').length },
  ];

  return (
    <PortalLayout portal="printer" title="Printer Production Dashboard">
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-white border border-[#E9E4F5] rounded-xl p-5">
              <div className="text-xs text-[#64607D]">{s.label}</div>
              <div className="mt-2 font-display text-2xl font-bold text-[#18142C] tabular-nums">
                {loading ? '—' : s.value}
              </div>
            </div>
          ))}
        </div>

        {/* SMART Encoding & Production Spec Sheet */}
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-3">
          <div className="flex items-center gap-2 font-display font-bold text-base text-[#18142C]">
            <Wifi className="h-5 w-5 text-[#7C3AED]" />
            <span>Printer SMART Encoding & 300 DPI Quality Checklist</span>
          </div>
          <ul className="text-sm text-[#64607D] space-y-1.5 list-disc pl-5">
            <li>Verify trim dimensions are exactly <strong>85.6 × 54.0 mm</strong> with <strong>3.0 mm bleed</strong> (91.6 × 60.0 mm PDF page).</li>
            <li>Never manually alter or stretch the embedded QR code—the downloaded PDF contains the verified backend QR code.</li>
            <li>Encode the order&apos;s exact public profile URL onto the NTAG215 chip as an NDEF URI record and lock/test with both iOS and Android readers.</li>
            <li>Enter courier name, tracking number, and dispatch date to trigger automated customer & admin dispatch notifications.</li>
          </ul>
          <Link
            to="/printer/orders"
            className="inline-block mt-2 px-5 py-2.5 bg-[#18142C] hover:bg-[#2A2048] text-white text-xs font-semibold rounded-xl transition-colors"
          >
            View Assigned Print Queue
          </Link>
        </div>
      </div>
    </PortalLayout>
  );
};

export const PrinterOrdersPage: React.FC = () => {
  const { userRecord } = useAuth();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userRecord) return;
    getPrinterOrders(userRecord.uid)
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [userRecord]);

  return (
    <PortalLayout portal="printer" title="Assigned Print Orders">
      {loading ? (
        <div className="h-48 bg-[#EFEBF9] rounded-2xl animate-pulse" />
      ) : orders.length === 0 ? (
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-10 text-center">
          <Printer className="h-8 w-8 text-[#7C3AED] mx-auto mb-2" />
          <h2 className="font-display font-bold text-lg text-[#18142C]">No Assigned Orders</h2>
          <p className="mt-1 text-sm text-[#64607D]">Orders assigned to your print facility by Admin will appear here.</p>
        </div>
      ) : (
        <div className="bg-white border border-[#E9E4F5] rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#FAF9FE] border-b border-[#E9E4F5] text-xs text-[#64607D]">
              <tr>
                <th className="py-3 px-4">Order #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Card Type</th>
                <th className="py-3 px-4">Qty</th>
                <th className="py-3 px-4">Destination</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Fulfilment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0ECF9]">
              {orders.map((ord) => (
                <tr key={ord.orderId} className="hover:bg-[#FAF9FE]">
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-[#18142C]">{ord.orderNumber}</td>
                  <td className="py-3 px-4 text-[#18142C]">{ord.shippingAddress.fullName}</td>
                  <td className="py-3 px-4 text-xs text-[#64607D]">{ord.cardType}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[#18142C]">{ord.quantity}</td>
                  <td className="py-3 px-4 text-xs text-[#64607D]">
                    {ord.shippingAddress.city}, {ord.shippingAddress.state} ({ord.shippingAddress.pinCode})
                  </td>
                  <td className="py-3 px-4 text-xs font-semibold text-[#7C3AED]">{ord.orderStatus}</td>
                  <td className="py-3 px-4 text-right">
                    <Link
                      to={`/printer/orders/${ord.orderId}`}
                      className="px-3 py-1.5 bg-[#18142C] hover:bg-[#2A2048] text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      Open Job
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalLayout>
  );
};

export const PrinterOrderDetailPage: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const { userRecord } = useAuth();
  const { notify } = useToast();

  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [design, setDesign] = useState<CardDesignRecord | null>(null);
  const [publicProfile, setPublicProfile] = useState<PublicProfileRecord | null>(null);
  const [qr, setQr] = useState<QrCodeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [updatingStep, setUpdatingStep] = useState(false);
  const [pendingStepStatus, setPendingStepStatus] = useState<OrderStatus | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineSuccess, setTimelineSuccess] = useState<string | null>(null);
  const [dispatchEmailWarning, setDispatchEmailWarning] = useState<string | null>(null);
  const [retryingDispatchEmail, setRetryingDispatchEmail] = useState(false);

  const [courierName, setCourierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));

  const loadJob = async (silent = false) => {
    if (!orderId) return;
    if (!silent) setLoading(true);
    try {
      const ord = await getOrderById(orderId);
      setOrder(ord);
      if (ord) {
        if (ord.courierName) setCourierName(ord.courierName);
        if (ord.trackingNumber) setTrackingNumber(ord.trackingNumber);
        if (ord.trackingUrl) setTrackingUrl(ord.trackingUrl);
        if (ord.dispatchDate) setDispatchDate(ord.dispatchDate);

        const [des, qrDoc, pubDoc] = await Promise.all([
          getCardDesignById(ord.designId),
          ord.qrCodeId ? getQrCodeById(ord.qrCodeId) : Promise.resolve(null),
          ord.profileSlug ? getPublicProfileBySlug(ord.profileSlug).catch(() => null) : Promise.resolve(null),
        ]);
        setDesign(des);
        setQr(qrDoc);
        setPublicProfile(pubDoc);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJob();
  }, [orderId]);

  const cardPersonalInfo: Partial<PersonalInformation> = order
    ? {
        ...(publicProfile?.personalInformation || {}),
        fullName: publicProfile?.personalInformation?.fullName || order.shippingAddress.fullName,
        mobile: publicProfile?.personalInformation?.mobile || order.shippingAddress.mobile,
        email: publicProfile?.personalInformation?.email || order.shippingAddress.email,
        businessAddress: publicProfile?.personalInformation?.businessAddress || order.shippingAddress.addressLine1,
        city: publicProfile?.personalInformation?.city || order.shippingAddress.city,
        state: publicProfile?.personalInformation?.state || order.shippingAddress.state,
        pinCode: publicProfile?.personalInformation?.pinCode || order.shippingAddress.pinCode,
        country: publicProfile?.personalInformation?.country || order.shippingAddress.country,
      }
    : {};

  const handleDownloadPrintPdf = async (withGuides: boolean) => {
    if (!design || !qr?.pngDataUrl || !order) {
      notify('Missing QR or design', 'Cannot build print-ready PDF without verified QR artwork.', 'error');
      return;
    }
    setGeneratingPdf(true);
    try {
      const result = await generatePrintReadyPdfBlob({
        design,
        info: cardPersonalInfo,
        qrPngDataUrl: qr.pngDataUrl,
        includeProofGuides: withGuides,
      });
      downloadBlob(result.blob, `${order.orderNumber}-${withGuides ? 'proof' : 'print-300dpi'}.pdf`);
      notify('Print PDF generated', `${result.specs.trimMm} + ${result.specs.bleedMm} bleed @ ${result.specs.dpi} DPI`, 'success');
    } catch (err) {
      notify('PDF generation failed', err instanceof Error ? err.message : 'Error creating PDF.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDownloadSidePng = async (side: 'front' | 'back') => {
    if (!design || !qr?.pngDataUrl || !order) {
      notify('Missing QR or design', 'Cannot export print PNG without verified QR artwork.', 'error');
      return;
    }
    setGeneratingPdf(true);
    try {
      const result = await generateCardSidePngBlob({
        design,
        side,
        info: cardPersonalInfo,
        qrPngDataUrl: qr.pngDataUrl,
      });
      downloadBlob(result.blob, `${order.orderNumber}-${side}.png`);
      notify(
        `${side === 'front' ? 'Front' : 'Back'} PNG downloaded`,
        `${result.widthPx} × ${result.heightPx} px (300 DPI PNG)`,
        'success'
      );
    } catch (err) {
      notify('PNG export failed', err instanceof Error ? err.message : 'Error creating PNG.', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleStatusStep = async (nextStatus: OrderStatus) => {
    if (!order) return;
    if (nextStatus === 'Dispatched' && !order.trackingNumber) {
      setTimelineSuccess(null);
      setTimelineError('Enter courier name and tracking number below to mark this order as Dispatched.');
      document.getElementById('printer-dispatch-form')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    await executeTimelineStatusUpdate({
      orderId: order.orderId,
      currentStatus: order.orderStatus,
      nextStatus,
      hasUserSession: Boolean(userRecord),
      isUpdating: updatingStep,
      updateOrderStatusFn: updateServerOrderStatus,
      onStart: (target) => {
        setUpdatingStep(true);
        setPendingStepStatus(target);
        setTimelineError(null);
        setTimelineSuccess(null);
      },
      onOptimisticUpdate: (target) => {
        setOrder((prev) => (prev ? { ...prev, orderStatus: target } : prev));
      },
      onSuccess: async (target) => {
        let emailWarningMsg: string | null = null;
        const emailTemplate =
          target === 'Printing in Progress'
            ? 'printing_started'
            : target === 'Delivered'
              ? 'delivered'
              : target === 'Dispatched' && order.trackingNumber
                ? 'dispatched'
                : null;

        if (emailTemplate) {
          try {
            const emailRes = await sendAndLogTransactionalEmail({
              orderId: order.orderId,
              uid: order.uid,
              to: order.shippingAddress.email,
              templateId: emailTemplate,
              variables:
                emailTemplate === 'dispatched'
                  ? buildDispatchedEmailVariables({
                      orderNumber: order.orderNumber,
                      orderId: order.orderId,
                      customerName: order.shippingAddress?.fullName || 'Valued Customer',
                      courierName: order.courierName || '',
                      trackingNumber: order.trackingNumber || '',
                      trackingUrl: order.trackingUrl || '',
                      dispatchDate: order.dispatchDate || new Date().toISOString().slice(0, 10),
                    })
                  : {
                      ORDER_NUMBER: order.orderNumber,
                      CUSTOMER_NAME: order.shippingAddress?.fullName || 'Valued Customer',
                    },
            });
            if (!emailRes.delivered) {
              const reason = formatEmailDeliveryFailureReason(emailRes);
              emailWarningMsg = reason
                ? `Status updated to "${target}", but customer email failed: ${reason}`
                : `Status updated to "${target}", but customer email could not be sent.`;
            }
          } catch (err) {
            emailWarningMsg =
              err instanceof Error
                ? `Status updated to "${target}", but customer email failed: ${err.message}`
                : `Status updated to "${target}", but customer email could not be sent.`;
          }
        }

        if (emailWarningMsg) {
          setDispatchEmailWarning(emailWarningMsg);
          setTimelineSuccess(null);
          notify('Status updated; email attention needed', emailWarningMsg, 'info');
        } else {
          setDispatchEmailWarning(null);
          setTimelineSuccess(`${order.orderNumber} updated to "${target}".`);
          notify('Order status updated', target, 'success');
        }
        await loadJob(true).catch(() => null);
      },
      onError: (friendlyMessage) => {
        setTimelineError(friendlyMessage);
        notify('Status update failed', friendlyMessage, 'error');
      },
      onFinish: () => {
        setUpdatingStep(false);
        setPendingStepStatus(null);
      },
    });
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !userRecord || updatingStep) return;
    setUpdatingStep(true);
    setPendingStepStatus('Dispatched');
    setTimelineError(null);
    setTimelineSuccess(null);
    setDispatchEmailWarning(null);
    try {
      await executeDispatchWithNotification({
        order,
        input: {
          orderId: order.orderId,
          courierName,
          trackingNumber,
          trackingUrl,
          dispatchDate,
        },
        createShippingRecordFn: createServerShippingRecord,
        sendEmailFn: sendAndLogTransactionalEmail,
        onDispatchSaved: (updatedOrder) => {
          setOrder(updatedOrder);
        },
        onEmailSuccess: (message) => {
          setDispatchEmailWarning(null);
          setTimelineSuccess(message);
          notify('Order dispatched', message, 'success');
        },
        onEmailFailure: (message, emailResult) => {
          const reason = formatEmailDeliveryFailureReason(emailResult);
          const fullMsg = reason ? `${message} Reason: ${reason}` : message;
          setTimelineSuccess(null);
          setDispatchEmailWarning(fullMsg);
          notify('Dispatch saved; email failed', fullMsg, 'info');
        },
        onSaveFailure: (message) => {
          setTimelineError(message);
          notify('Dispatch failed', message, 'error');
        },
      });
      await loadJob(true).catch(() => null);
    } finally {
      setUpdatingStep(false);
      setPendingStepStatus(null);
    }
  };

  const handleRetryDispatchEmail = async () => {
    if (!order || !userRecord || retryingDispatchEmail) return;
    setRetryingDispatchEmail(true);
    setTimelineError(null);
    try {
      await executeRetryDispatchEmail({
        order,
        sendEmailFn: sendAndLogTransactionalEmail,
        onEmailSuccess: (message) => {
          setDispatchEmailWarning(null);
          setTimelineSuccess(message);
          notify('Customer email sent', message, 'success');
        },
        onEmailFailure: (message, emailResult) => {
          const reason = formatEmailDeliveryFailureReason(emailResult);
          const fullMsg = reason ? `${message} Reason: ${reason}` : message;
          setTimelineSuccess(null);
          setDispatchEmailWarning(fullMsg);
          notify('Email retry failed', fullMsg, 'error');
        },
      });
    } finally {
      setRetryingDispatchEmail(false);
    }
  };

  if (loading) {
    return (
      <PortalLayout portal="printer" title="Print Job Details">
        <div className="h-64 bg-[#EFEBF9] rounded-2xl animate-pulse" />
      </PortalLayout>
    );
  }

  if (!order) {
    return (
      <PortalLayout portal="printer" title="Print Job Details">
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-8 text-center text-sm text-[#64607D]">
          Order not found or not assigned to your printer account.
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout portal="printer" title={`Print Job: ${order.orderNumber}`}>
      <div className="space-y-6">
        {/* Header Summary */}
        <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-mono text-[#64607D]">Order {order.orderNumber} · Qty {order.quantity} · {order.cardType}</div>
            <h2 className="font-display text-xl font-bold text-[#18142C] mt-0.5">
              Status: {order.orderStatus}
            </h2>
            <p className="text-xs text-[#64607D] mt-1">
              Ship to: {order.shippingAddress.fullName}, {order.shippingAddress.addressLine1}, {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.pinCode} · Ph: {order.shippingAddress.mobile}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={generatingPdf}
              onClick={() => handleDownloadPrintPdf(false)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#18142C] hover:bg-[#2A2048] text-white text-xs font-semibold rounded-xl disabled:opacity-50 cursor-pointer transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>{generatingPdf ? 'Rendering...' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              disabled={generatingPdf}
              onClick={() => handleDownloadSidePng('front')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-[#DDD6FE] text-xs font-semibold rounded-xl text-[#18142C] hover:bg-[#FAF9FE] disabled:opacity-50 cursor-pointer transition-colors"
            >
              <ImageIcon className="h-4 w-4 text-[#7C3AED]" />
              <span>Front PNG</span>
            </button>
            <button
              type="button"
              disabled={generatingPdf}
              onClick={() => handleDownloadSidePng('back')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-[#DDD6FE] text-xs font-semibold rounded-xl text-[#18142C] hover:bg-[#FAF9FE] disabled:opacity-50 cursor-pointer transition-colors"
            >
              <ImageIcon className="h-4 w-4 text-emerald-600" />
              <span>Back PNG</span>
            </button>
            <button
              type="button"
              disabled={generatingPdf}
              onClick={() => handleDownloadPrintPdf(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#DDD6FE] text-xs font-semibold rounded-xl text-[#18142C] hover:bg-[#FAF9FE] disabled:opacity-50 cursor-pointer transition-colors"
            >
              <FileText className="h-4 w-4" />
              <span>Download Proof w/ Guides</span>
            </button>
          </div>
        </div>

        {/* Interactive Fulfilment Timeline */}
        <FulfilmentTimeline
          currentStatus={order.orderStatus}
          interactive
          allowedStatuses={[
            'Processing',
            'Assigned to Printer',
            'Printing in Progress',
            'Quality Check',
            'Ready for Dispatch',
            'Dispatched',
            'In Transit',
            'Delivered',
          ]}
          updating={updatingStep}
          pendingStatus={pendingStepStatus}
          errorMessage={timelineError}
          warningMessage={dispatchEmailWarning}
          successMessage={timelineSuccess}
          retryActionLabel="Retry Dispatch Email"
          retryingAction={retryingDispatchEmail}
          onRetryAction={handleRetryDispatchEmail}
          onDismissError={() => setTimelineError(null)}
          onDismissWarning={() => setDispatchEmailWarning(null)}
          onDismissSuccess={() => setTimelineSuccess(null)}
          courierName={order.courierName}
          trackingNumber={order.trackingNumber}
          trackingUrl={order.trackingUrl}
          dispatchDate={order.dispatchDate}
          onSelectStatus={handleStatusStep}
          onOpenDispatchForm={() => {
            setTimelineError(null);
            setTimelineSuccess(null);
            document.getElementById('printer-dispatch-form')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />

        {/* Print Proof Preview (Front + Back with Actual QR Injected) */}
        {design && (
          <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6">
            <h3 className="font-display font-bold text-sm text-[#18142C] mb-4">
              Print Proof Preview (Trim: 85.6 × 54 mm · Bleed: 3 mm · Safe: 4 mm)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-medium text-[#64607D] mb-2">Front Artwork</div>
                <CardCanvasPreview
                  side={design.frontDesign}
                  orientation={design.cardOrientation}
                  personalInfo={cardPersonalInfo}
                  actualQrPng={qr?.pngDataUrl}
                  showPrintGuides
                />
              </div>
              <div>
                <div className="text-xs font-medium text-[#64607D] mb-2">Back Artwork (Verified QR Embedded)</div>
                <CardCanvasPreview
                  side={design.backDesign}
                  orientation={design.cardOrientation}
                  personalInfo={cardPersonalInfo}
                  actualQrPng={qr?.pngDataUrl}
                  showPrintGuides
                />
              </div>
            </div>
          </div>
        )}

        {/* SMART Encoding Target + QR Artifact + Dispatch Form */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-3">
            <h3 className="font-display font-bold text-sm text-[#18142C]">SMART Encoding & Verified QR Target</h3>
            <p className="text-xs text-[#64607D]">
              Encode this exact NDEF URI onto the card&apos;s SMART chip during manufacturing:
            </p>
            <div className="p-3 bg-[#FAF9FE] border border-[#E9E4F5] rounded-lg font-mono text-xs text-[#7C3AED] break-all">
              {qr?.targetUrl || `${window.location.origin}/p/${order.profileSlug}`}
            </div>
            {qr?.pngDataUrl && (
              <div className="flex items-center gap-4 pt-2">
                <img src={qr.pngDataUrl} alt="Verified QR" className="w-24 h-24 border border-[#E9E4F5] rounded-lg" />
                <div className="space-y-2">
                  <a
                    href={qr.pngDataUrl}
                    download={`${order.orderNumber}-qr.png`}
                    className="block px-3 py-1.5 bg-[#F3EEFF] hover:bg-[#EAE3FF] rounded text-xs font-semibold text-[#18142C] text-center"
                  >
                    Download QR PNG
                  </a>
                </div>
              </div>
            )}
          </div>

          <div id="printer-dispatch-form" className="bg-white border border-[#E9E4F5] rounded-2xl p-6 space-y-4">
            <form onSubmit={handleDispatch} className="space-y-3">
              <div className="flex items-center gap-2 font-display font-bold text-sm text-[#18142C]">
                <Truck className="h-4 w-4 text-[#7C3AED]" />
                <span>Mark Dispatched</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={courierName}
                  onChange={(e) => setCourierName(e.target.value)}
                  placeholder="Courier name (e.g. BlueDart)"
                  className="px-3 py-2 border border-[#DDD6FE] rounded-lg text-xs text-[#18142C]"
                />
                <input
                  type="text"
                  required
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="Tracking / AWB number"
                  className="px-3 py-2 border border-[#DDD6FE] rounded-lg text-xs font-mono text-[#18142C]"
                />
                <input
                  type="url"
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                  placeholder="Tracking URL (optional)"
                  className="px-3 py-2 border border-[#DDD6FE] rounded-lg text-xs text-[#18142C]"
                />
                <input
                  type="date"
                  required
                  value={dispatchDate}
                  onChange={(e) => setDispatchDate(e.target.value)}
                  className="px-3 py-2 border border-[#DDD6FE] rounded-lg text-xs font-mono text-[#18142C]"
                />
              </div>
              <button
                type="submit"
                disabled={updatingStep}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updatingStep ? 'Updating Dispatch...' : 'Confirm Dispatch & Notify Customer'}
              </button>
              {dispatchEmailWarning && order.orderStatus === 'Dispatched' && (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={retryingDispatchEmail}
                    onClick={() => void handleRetryDispatchEmail()}
                    className="w-full py-2 border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    {retryingDispatchEmail ? 'Retrying Dispatch Email...' : 'Retry Dispatch Email'}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
};

export const PrinterProfilePage: React.FC = () => {
  const { userRecord } = useAuth();
  const { notify } = useToast();
  const [printer, setPrinter] = useState<PrinterRecord | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    if (!userRecord) return;
    getDoc(doc(db, 'printers', userRecord.uid)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as PrinterRecord;
        setPrinter(d);
        setBusinessName(d.businessName);
        setContactPerson(d.contactPerson);
        setPhone(d.phone || '');
        setAddress(d.address || '');
      }
    });
  }, [userRecord]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRecord || !printer) return;
    try {
      await updateDoc(doc(db, 'printers', userRecord.uid), {
        businessName,
        contactPerson,
        phone,
        address,
        updatedAt: serverTimestamp(),
      });
      notify('Facility profile saved', 'Printer details updated.', 'success');
    } catch (err) {
      notify(
        'Save failed',
        formatFirestoreErrorMessage(err, 'Unable to update facility profile.'),
        'error'
      );
    }
  };

  return (
    <PortalLayout portal="printer" title="Printer Facility Profile">
      <form onSubmit={handleSave} className="bg-white border border-[#E9E4F5] rounded-2xl p-6 max-w-xl space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#64607D] mb-1">Business / Press Name</label>
          <input
            type="text"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-[#DDD6FE] rounded-lg text-sm text-[#18142C]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64607D] mb-1">Contact Person</label>
          <input
            type="text"
            required
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-[#DDD6FE] rounded-lg text-sm text-[#18142C]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64607D] mb-1">Fulfilment Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-[#DDD6FE] rounded-lg text-sm font-mono text-[#18142C]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#64607D] mb-1">Facility Address</label>
          <textarea
            rows={3}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-[#DDD6FE] rounded-lg text-sm text-[#18142C]"
          />
        </div>
        <button type="submit" className="px-5 py-2.5 bg-[#18142C] hover:bg-[#2A2048] text-white text-sm font-semibold rounded-xl cursor-pointer transition-colors">
          Save Facility Profile
        </button>
      </form>
    </PortalLayout>
  );
};
