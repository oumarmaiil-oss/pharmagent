import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpCircle,
  BookmarkCheck,
  Camera,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  Crosshair,
  Download,
  FileSpreadsheet,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Mail,
  Monitor,
  PackageCheck,
  Phone,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { AuditLogView } from './AuditLogView';
import { DesktopAgentSetupGuide } from './DesktopAgentSetupGuide';
import { PharmacyLoginCard } from './PharmacyLoginCard';
import {
  AuditLogEntry,
  DocumentCategory,
  DraftRecord,
  ExtractedDocumentData,
  ExtractedLineItem,
  GroundingAnalysisResult,
  OfficineRecord,
  OwnerAuthSession,
  PharmacyAuthSession,
  PharmacyUserAccount,
  PharmacyUserRole,
  QueuedDesktopTask,
  QuotaRequestKind,
  QuotaTopUpRequest,
  StockItemRecord,
  TargetExecutionMode,
} from '../types/pharmagent';
import { PanelIllustration } from './Illustrations';

interface PharmacistWorkspaceProps {
  pharmacies: OfficineRecord[];
  selectedPharmacyId: string;
  onChangePharmacyId: (id: string) => void;
  drafts: DraftRecord[];
  stock: StockItemRecord[];
  taskQueue: QueuedDesktopTask[];
  auditLogs?: AuditLogEntry[];
  quotaRequests?: QuotaTopUpRequest[];
  onDataUpdated: () => void;
  lockedPharmacy?: boolean;
  ownerSession?: OwnerAuthSession | null;
  onPortalAuthChange?: (session: PharmacyAuthSession | null) => void;
  onExitRemoteIntervention?: () => void;
}

const ROLE_LABELS: Record<PharmacyUserRole, string> = {
  titulaire: 'Pharmacien titulaire',
  adjoint: 'Pharmacien adjoint / Gérant',
  assistant: 'Assistant / Préparateur',
};

export const PharmacistWorkspace: React.FC<PharmacistWorkspaceProps> = ({
  pharmacies,
  selectedPharmacyId,
  onChangePharmacyId,
  drafts,
  stock,
  taskQueue,
  auditLogs = [],
  quotaRequests = [],
  onDataUpdated,
  lockedPharmacy = false,
  ownerSession = null,
  onPortalAuthChange,
  onExitRemoteIntervention,
}) => {
  const [linkCopied, setLinkCopied] = useState(false);
  const selectedPharmacy = useMemo(
    () => pharmacies.find((p) => p.id === selectedPharmacyId) || pharmacies[0],
    [pharmacies, selectedPharmacyId]
  );

  // Camera & Photo State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string>('image/jpeg');
  const [sampleFallbackPath, setSampleFallbackPath] = useState<string | null>(null);

  // Task & Target Mode State
  const [documentHint, setDocumentHint] = useState<DocumentCategory>('bon_livraison');
  const [taskPrompt, setTaskPrompt] = useState<string>(
    'Extrais tous les médicaments, quantités et numéros de lot, puis prépare le brouillon d’entrée en stock.'
  );
  const [targetMode, setTargetMode] = useState<TargetExecutionMode>('excel_upload');
  const [uploadedExcelBase64, setUploadedExcelBase64] = useState<string | null>(null);
  const [uploadedExcelName, setUploadedExcelName] = useState<string | null>(null);

  // Execution State
  const [runningTask, setRunningTask] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [lastCreatedDraft, setLastCreatedDraft] = useState<DraftRecord | null>(null);

  // Pharmacist Review, Stock & Software Learning View
  const [workspaceSubTab, setWorkspaceSubTab] = useState<
    'drafts' | 'stock' | 'desktop_queue' | 'learn_software' | 'audit' | 'users'
  >('drafts');
  const [editingItemsByDraft, setEditingItemsByDraft] = useState<Record<string, ExtractedLineItem[]>>({});
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Pharmacy Authentication & Role-based Access
  const [authSession, setAuthSession] = useState<PharmacyAuthSession | null>(null);
  const [authChecking, setAuthChecking] = useState(false);
  const [forcePharmacyLogin, setForcePharmacyLogin] = useState(false);

  // Self-service Password Change State (for Pharmacy Users)
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPwdInput, setCurrentPwdInput] = useState('');
  const [newPwdInput, setNewPwdInput] = useState('');
  const [confirmPwdInput, setConfirmPwdInput] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  const [pharmacyUsers, setPharmacyUsers] = useState<PharmacyUserAccount[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersFeedback, setUsersFeedback] = useState<string | null>(null);
  const [newUserLoginId, setNewUserLoginId] = useState('');
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserRole, setNewUserRole] = useState<PharmacyUserRole>('assistant');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  // Direct Software Learning from Pharmacist Link
  const [learnScreenshotBase64, setLearnScreenshotBase64] = useState<string | null>(null);
  const [learnScreenshotMime, setLearnScreenshotMime] = useState<string>('image/png');
  const [learnSoftwareName, setLearnSoftwareName] = useState<string>('');
  const [learningGroundLoading, setLearningGroundLoading] = useState(false);
  const [learningSaveLoading, setLearningSaveLoading] = useState(false);
  const [learnGroundingResult, setLearnGroundingResult] = useState<GroundingAnalysisResult | null>(null);
  const [learnFeedback, setLearnFeedback] = useState<string | null>(null);
  const [learnError, setLearnError] = useState<string | null>(null);

  // Closed-Loop Quota Recharge / Plan Upgrade Request
  const [showQuotaRequestPanel, setShowQuotaRequestPanel] = useState(false);
  const [requestedQuotaKind, setRequestedQuotaKind] = useState<QuotaRequestKind>('topup_25');
  const [quotaRequestNote, setQuotaRequestNote] = useState('');
  const [sendingQuotaReq, setSendingQuotaReq] = useState(false);
  const [quotaReqSuccess, setQuotaReqSuccess] = useState<string | null>(null);
  const [quotaReqError, setQuotaReqError] = useState<string | null>(null);

  const isOwnerActing = Boolean(!authSession && ownerSession && !lockedPharmacy && !forcePharmacyLogin);
  const effectiveToken = authSession?.token || (isOwnerActing ? ownerSession?.token || '' : '');
  const isAuthenticated = Boolean(authSession || isOwnerActing);

  const userRole = authSession?.user.role;
  const canApproveDraft = isOwnerActing || userRole === 'titulaire' || userRole === 'adjoint';
  const canRejectDraft = isOwnerActing || userRole === 'titulaire';
  const canManageUsers = isOwnerActing || userRole === 'titulaire';
  const canLearnSoftware = isOwnerActing || userRole === 'titulaire';
  const canExportOfficialPdf = isOwnerActing || userRole === 'titulaire' || userRole === 'adjoint';

  useEffect(() => {
    let cancelled = false;
    const storageKey = `pharmagent_auth_${selectedPharmacyId}`;
    const roleKey = `pharmagent_role_${selectedPharmacyId}`;
    setUsersError(null);
    setUsersFeedback(null);
    setPharmacyUsers([]);
    setShowPasswordForm(false);
    setPwdError(null);
    setPwdSuccess(null);

    const savedRaw =
      typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null;
    if (!savedRaw) {
      setAuthSession(null);
      onPortalAuthChange?.(null);
      return;
    }

    try {
      const parsed = JSON.parse(savedRaw) as PharmacyAuthSession;
      setAuthChecking(true);
      fetch(`/api/pharmacies/${selectedPharmacyId}/auth/me`, {
        headers: { Authorization: `Bearer ${parsed.token}` },
      })
        .then(async (res) => {
          if (cancelled) return;
          if (!res.ok) {
            window.sessionStorage.removeItem(storageKey);
            window.sessionStorage.removeItem(roleKey);
            setAuthSession(null);
            onPortalAuthChange?.(null);
            return;
          }
          const data = (await res.json()) as { user: PharmacyUserAccount };
          window.sessionStorage.setItem(roleKey, data.user.role);
          const nextSession = { token: parsed.token, user: data.user };
          setAuthSession(nextSession);
          onPortalAuthChange?.(nextSession);
        })
        .catch(() => {
          if (!cancelled) {
            setAuthSession(null);
            onPortalAuthChange?.(null);
          }
        })
        .finally(() => {
          if (!cancelled) setAuthChecking(false);
        });
    } catch {
      setAuthSession(null);
      onPortalAuthChange?.(null);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPharmacyId]);

  const fetchPharmacyUsers = async (token: string) => {
    if (!token) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await fetch(`/api/pharmacies/${selectedPharmacyId}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Impossible de charger les utilisateurs.');
      setPharmacyUsers(data.users || []);
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : 'Erreur chargement utilisateurs.');
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && canManageUsers && effectiveToken) {
      fetchPharmacyUsers(effectiveToken);
    }
    if (isAuthenticated && !canManageUsers && workspaceSubTab === 'users') {
      setWorkspaceSubTab('drafts');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveToken, canManageUsers, selectedPharmacyId, isAuthenticated]);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(`pharmagent_auth_${selectedPharmacyId}`);
      window.sessionStorage.removeItem(`pharmagent_role_${selectedPharmacyId}`);
    }
    setAuthSession(null);
    onPortalAuthChange?.(null);
    setPharmacyUsers([]);
    setWorkspaceSubTab('drafts');
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authSession) return;
    setPwdError(null);
    setPwdSuccess(null);
    if (newPwdInput.trim().length < 6) {
      setPwdError('Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (newPwdInput !== confirmPwdInput) {
      setPwdError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setPwdSaving(true);
    try {
      const res = await fetch(`/api/pharmacies/${selectedPharmacyId}/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession.token}`,
        },
        body: JSON.stringify({
          currentPassword: currentPwdInput,
          newPassword: newPwdInput.trim(),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Modification impossible.');
      const updatedSession: PharmacyAuthSession = {
        token: authSession.token,
        user: payload.user,
      };
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          `pharmagent_auth_${selectedPharmacyId}`,
          JSON.stringify(updatedSession)
        );
      }
      setAuthSession(updatedSession);
      onPortalAuthChange?.(updatedSession);
      setCurrentPwdInput('');
      setNewPwdInput('');
      setConfirmPwdInput('');
      setShowPasswordForm(false);
      setPwdSuccess('Votre mot de passe personnel a été enregistré.');
    } catch (err: unknown) {
      setPwdError(err instanceof Error ? err.message : 'Erreur modification mot de passe.');
    } finally {
      setPwdSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveToken) return;
    setCreatingUser(true);
    setUsersError(null);
    setUsersFeedback(null);
    try {
      const res = await fetch(`/api/pharmacies/${selectedPharmacyId}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({
          loginId: newUserLoginId.trim(),
          fullName: newUserFullName.trim(),
          role: newUserRole,
          password: newUserPassword,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Impossible de créer le compte.');
      setPharmacyUsers(payload.users || []);
      setUsersFeedback(
        `Compte « @${payload.user.loginId} » (${
          ROLE_LABELS[payload.user.role as PharmacyUserRole] || payload.user.role
        }) créé avec mot de passe provisoire.`
      );
      setNewUserLoginId('');
      setNewUserFullName('');
      setNewUserPassword('');
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : 'Erreur création compte.');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleUserActive = async (user: PharmacyUserAccount) => {
    if (!effectiveToken) return;
    setUsersError(null);
    setUsersFeedback(null);
    try {
      const res = await fetch(`/api/pharmacies/${selectedPharmacyId}/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({ active: !user.active }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Modification impossible.');
      setPharmacyUsers(payload.users || []);
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : 'Erreur mise à jour.');
    }
  };

  const handleChangeUserRole = async (user: PharmacyUserAccount, role: PharmacyUserRole) => {
    if (!effectiveToken) return;
    setUsersError(null);
    try {
      const res = await fetch(`/api/pharmacies/${selectedPharmacyId}/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({ role }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Modification impossible.');
      setPharmacyUsers(payload.users || []);
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : 'Erreur modification rôle.');
    }
  };

  const handleSaveResetPassword = async (userId: string) => {
    if (!effectiveToken || !resetPasswordValue.trim()) return;
    setUsersError(null);
    setUsersFeedback(null);
    try {
      const res = await fetch(`/api/pharmacies/${selectedPharmacyId}/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({ password: resetPasswordValue.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Erreur réinitialisation mot de passe.');
      setPharmacyUsers(payload.users || []);
      setResetPasswordUserId(null);
      setResetPasswordValue('');
      setUsersFeedback(
        `Mot de passe provisoire mis à jour pour @${payload.user.loginId}.`
      );
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : 'Erreur mot de passe.');
    }
  };

  const handleDeleteUser = async (user: PharmacyUserAccount) => {
    if (!effectiveToken) return;
    setUsersError(null);
    setUsersFeedback(null);
    try {
      const res = await fetch(`/api/pharmacies/${selectedPharmacyId}/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${effectiveToken}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Suppression impossible.');
      setPharmacyUsers(payload.users || []);
      setUsersFeedback(`Compte @${user.loginId} supprimé.`);
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : 'Erreur suppression.');
    }
  };

  const pharmacyDrafts = useMemo(
    () => drafts.filter((d) => d.pharmacyId === selectedPharmacyId),
    [drafts, selectedPharmacyId]
  );

  const pharmacyStock = useMemo(
    () => stock.filter((s) => s.pharmacyId === selectedPharmacyId),
    [stock, selectedPharmacyId]
  );

  const pharmacyQueue = useMemo(
    () => taskQueue.filter((t) => t.pharmacyId === selectedPharmacyId),
    [taskQueue, selectedPharmacyId]
  );

  const pharmacyAuditLogs = useMemo(
    () => auditLogs.filter((l) => l.pharmacyId === selectedPharmacyId),
    [auditLogs, selectedPharmacyId]
  );

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (workspaceSubTab !== 'desktop_queue') return;
    const hasPending = pharmacyQueue.some((t) => t.status === 'EN_ATTENTE_AGENT_LOCAL');
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      onDataUpdated();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [workspaceSubTab, pharmacyQueue, onDataUpdated]);

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Votre navigateur ne supporte pas la capture vidéo directe. Utilisez le bouton « Importer / Photo mobile ».'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 60);
    } catch {
      setCameraError(
        'Accès caméra refusé ou aucun capteur détecté. Vous pouvez importer directement une photo depuis votre appareil.'
      );
    }
  };

  const capturePhotoFromCamera = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setPhotoPreview(dataUrl);
    setPhotoMime('image/jpeg');
    setSampleFallbackPath(null);
    stopCamera();
  };

  const handlePhotoUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result as string);
      setPhotoMime(file.type || 'image/jpeg');
      setSampleFallbackPath(null);
      stopCamera();
    };
    reader.readAsDataURL(file);
  };

  const handleExcelUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedExcelBase64(reader.result as string);
      setUploadedExcelName(file.name);
      setTargetMode('excel_upload');
    };
    reader.readAsDataURL(file);
  };

  const handleLoadProposedExcelTemplate = async (
    templateType: 'custom_kit' | 'facture_sdr' = 'custom_kit'
  ) => {
    try {
      const res = await fetch(`/api/training/download/${templateType}`);
      if (!res.ok) throw new Error('Impossible de charger le modèle Excel.');
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedExcelBase64(reader.result as string);
        setUploadedExcelName(
          templateType === 'facture_sdr'
            ? 'PharmAgent_4_Modele_Facture_SDR.xlsx'
            : 'PharmAgent_3_Fichier_Test_Propose.xlsx'
        );
        setTargetMode('excel_upload');
        setTaskError(null);
      };
      reader.readAsDataURL(blob);
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : 'Erreur chargement Excel test.');
    }
  };

  const handleLaunchMission = async () => {
    if (!photoPreview && !sampleFallbackPath) {
      setTaskError('Prenez une photo avec la caméra ou importez un document avant de lancer l’agent.');
      return;
    }
    if (targetMode === 'excel_upload' && !uploadedExcelBase64) {
      setTaskError('Importez votre fichier Excel (.xlsx) cible ou choisissez un autre mode.');
      return;
    }

    setRunningTask(true);
    setTaskError(null);
    setActionFeedback(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (effectiveToken) {
        headers.Authorization = `Bearer ${effectiveToken}`;
      }
      const res = await fetch('/api/agent/run-task', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pharmacyId: selectedPharmacyId,
          taskPrompt,
          documentHint,
          imageBase64: photoPreview || undefined,
          sampleAssetPath: photoPreview ? undefined : sampleFallbackPath,
          mimeType: photoMime,
          targetMode,
          uploadedExcelBase64: uploadedExcelBase64 || undefined,
          uploadedExcelName: uploadedExcelName || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Échec de l’exécution de l’agent.');
      }

      setLastCreatedDraft(payload.draft);
      setWorkspaceSubTab(targetMode === 'local_desktop' ? 'desktop_queue' : 'drafts');
      const learnedMsg =
        payload.learnedColumnsCount > 0
          ? ` (+${payload.learnedColumnsCount} nouvelle(s) colonne(s) mémorisée(s))`
          : '';
      setActionFeedback(
        `Brouillon ${payload.draft.extracted.documentNumber} créé par l’agent${learnedMsg}. En attente de validation.`
      );
      onDataUpdated();
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : 'Erreur lors du lancement de l’agent.');
    } finally {
      setRunningTask(false);
    }
  };

  const updateDraftItemField = (
    draft: DraftRecord,
    idx: number,
    field: keyof ExtractedLineItem,
    value: string | number
  ) => {
    const current = editingItemsByDraft[draft.id] || draft.extracted.lineItems;
    const next = current.map((item, i) => (i === idx ? { ...item, [field]: value } : item));
    setEditingItemsByDraft((prev) => ({ ...prev, [draft.id]: next }));
  };

  const handleSavePreCorrections = async (draft: DraftRecord) => {
    const edited = editingItemsByDraft[draft.id];
    if (!edited || !effectiveToken) return;
    setSavingDraftId(draft.id);
    setTaskError(null);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/items`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({ lineItems: edited }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Erreur sauvegarde pré-corrections.');
      setEditingItemsByDraft((prev) => {
        const copy = { ...prev };
        delete copy[draft.id];
        return copy;
      });
      setActionFeedback(
        `Pré-corrections enregistrées sur le brouillon ${draft.extracted.documentNumber}. En attente de validation finale.`
      );
      onDataUpdated();
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : 'Erreur sauvegarde.');
    } finally {
      setSavingDraftId(null);
    }
  };

  const handleApproveDraft = async (draft: DraftRecord) => {
    if (!effectiveToken || !canApproveDraft) {
      setTaskError('Action réservée au Pharmacien titulaire ou Pharmacien adjoint.');
      return;
    }
    setApprovingId(draft.id);
    setActionFeedback(null);
    setTaskError(null);
    try {
      const itemsToSave = editingItemsByDraft[draft.id] || draft.extracted.lineItems;
      const actorDisplay = authSession
        ? `${authSession.user.fullName} (@${authSession.user.loginId})`
        : `${ownerSession?.owner.fullName} (Propriétaire)`;
      const res = await fetch(`/api/drafts/${draft.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({
          lineItems: itemsToSave,
          pharmacistName: actorDisplay,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Erreur validation.');
      setEditingItemsByDraft((prev) => {
        const copy = { ...prev };
        delete copy[draft.id];
        return copy;
      });
      setActionFeedback(
        `Document ${draft.extracted.documentNumber} validé par ${payload.draft.validatedBy}. Le stock de l’officine et la mémoire des corrections ont été mis à jour.`
      );
      setWorkspaceSubTab('stock');
      onDataUpdated();
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : 'Erreur lors de la validation.');
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectDraft = async (draftId: string) => {
    if (!effectiveToken || !canRejectDraft) {
      setTaskError('Suppression réservée au Pharmacien titulaire ou au Propriétaire.');
      return;
    }
    setTaskError(null);
    const res = await fetch(`/api/drafts/${draftId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${effectiveToken}` },
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setTaskError(payload.error || 'Erreur lors du rejet.');
      return;
    }
    onDataUpdated();
  };

  const handleLearnScreenshotFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setLearnScreenshotBase64(reader.result as string);
      setLearnScreenshotMime(file.type || 'image/png');
      setLearnGroundingResult(null);
      setLearnFeedback(null);
      setLearnError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleLearnPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const blob = items[i].getAsFile();
        if (blob) {
          handleLearnScreenshotFile(blob);
          break;
        }
      }
    }
  };

  const handleAnalyzeAndLearnSoftware = async (saveImmediately: boolean) => {
    if (!learnScreenshotBase64) {
      setLearnError('Importez ou collez (Ctrl+V) une capture d’écran du logiciel Windows.');
      return;
    }
    setLearningGroundLoading(true);
    setLearnError(null);
    setLearnFeedback(null);

    const referenceExtracted: ExtractedDocumentData = lastCreatedDraft?.extracted ||
      pharmacyDrafts[0]?.extracted || {
        documentType: 'bon_livraison',
        documentNumber: 'BL-REF-001',
        supplierOrOrg: 'FOURNISSEUR EXEMPLE',
        recipientPharmacy: selectedPharmacy?.name || 'Pharmacie',
        documentDate: '18/11/2026',
        currency: 'FCFA',
        totalAmountFCFA: 18500,
        lineItems: [
          {
            designation: 'Amoxicilline 500mg Gélule B/24',
            quantity: 10,
            lotNumber: 'LOT-001',
            expiryDate: '06/2028',
            unitPriceFCFA: 1850,
            confidence: 0.99,
          },
        ],
      };

    try {
      const groundHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (effectiveToken) {
        groundHeaders.Authorization = `Bearer ${effectiveToken}`;
      }
      const groundRes = await fetch('/api/agent/ground', {
        method: 'POST',
        headers: groundHeaders,
        body: JSON.stringify({
          pharmacyId: selectedPharmacyId,
          extractedData: referenceExtracted,
          screenshotBase64: learnScreenshotBase64,
          mimeType: learnScreenshotMime,
        }),
      });
      const groundPayload = await groundRes.json();
      if (!groundRes.ok) {
        throw new Error(groundPayload.error || 'Échec de l’analyse visuelle de l’écran.');
      }
      const grounding: GroundingAnalysisResult = groundPayload.grounding;
      setLearnGroundingResult(grounding);

      if (saveImmediately) {
        setLearningSaveLoading(true);
        const targetName =
          learnSoftwareName.trim() ||
          selectedPharmacy?.targetSoftware ||
          grounding.targetInterfaceTitle ||
          'Logiciel Officine Windows';

        const saveHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (effectiveToken) {
          saveHeaders.Authorization = `Bearer ${effectiveToken}`;
        }
        const saveRes = await fetch('/api/training/software-profiles', {
          method: 'POST',
          headers: saveHeaders,
          body: JSON.stringify({
            softwareName: targetName,
            pharmacyId: selectedPharmacyId,
            detectedSoftwareType: grounding.detectedSoftwareType,
            elements: grounding.elements,
            injectionScript: '',
          }),
        });
        const savePayload = await saveRes.json();
        if (!saveRes.ok) {
          throw new Error(savePayload.error || 'Échec sauvegarde du profil logiciel.');
        }
        setLearnFeedback(
          `Logiciel « ${savePayload.profile.softwareName} » mémorisé pour de bon (${savePayload.profile.elements.length} zones + verrouillage validation finale). L’agent Windows l’appliquera automatiquement.`
        );
      }
      onDataUpdated();
    } catch (err: unknown) {
      setLearnError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setLearningGroundLoading(false);
      setLearningSaveLoading(false);
    }
  };

  const handleCopyPharmacyUrl = async () => {
    if (!selectedPharmacy || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('mode', 'officine');
    url.searchParams.set('key', selectedPharmacy.agentKey);
    try {
      await navigator.clipboard.writeText(url.toString());
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const quotaUsed = selectedPharmacy?.monthlyQuotaUsed || 0;
  const quotaLimit = Math.max(selectedPharmacy?.monthlyQuotaLimit || 1, 1);
  const quotaPct = Math.min(100, Math.round((quotaUsed / quotaLimit) * 100));
  const quotaLeftPct = Math.max(0, 100 - quotaPct);
  const planName =
    selectedPharmacy?.subscriptionPlan === 'enterprise'
      ? 'Réseau'
      : selectedPharmacy?.subscriptionPlan === 'pro'
      ? 'Pro'
      : 'Starter';
  const planDailyPace =
    selectedPharmacy?.subscriptionPlan === 'enterprise'
      ? '~15–20 BL/j'
      : selectedPharmacy?.subscriptionPlan === 'pro'
      ? '~10 BL/j'
      : '~5 BL/j';
  const pharmacyRequests = useMemo(
    () => quotaRequests.filter((r) => r.pharmacyId === selectedPharmacyId),
    [quotaRequests, selectedPharmacyId]
  );

  const handleSubmitQuotaRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveToken || !selectedPharmacy) return;
    setSendingQuotaReq(true);
    setQuotaReqError(null);
    setQuotaReqSuccess(null);
    try {
      const res = await fetch(`/api/pharmacies/${selectedPharmacy.id}/quota-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({
          requestedKind: requestedQuotaKind,
          note: quotaRequestNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Impossible d’envoyer la demande.');
      }
      setQuotaRequestNote('');
      setQuotaReqSuccess(
        'Demande transmise au Superviseur (Dr. Oumar). Dès validation, votre jauge sera créditée automatiquement.'
      );
      onDataUpdated();
    } catch (err: unknown) {
      setQuotaReqError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSendingQuotaReq(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Remote Supervisor Intervention Banner (only shown when Owner intervenes from Superviseur) */}
      {isOwnerActing && !lockedPharmacy && selectedPharmacy && (
        <section className="rounded-xl border border-amber-700/70 bg-amber-950/35 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-amber-200">
            <Wrench className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              <strong>Mode Intervention Superviseur à distance</strong> sur{' '}
              <strong className="text-white">{selectedPharmacy.name}</strong> · Les équipes de
              l’officine utilisent uniquement leur lien séparé ci-contre.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyPharmacyUrl}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500 transition-colors whitespace-nowrap shrink-0"
            >
              {linkCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Lien séparé copié
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-sky-400" />
                  Copier lien séparé officine
                </>
              )}
            </button>
            {onExitRemoteIntervention && (
              <button
                type="button"
                onClick={onExitRemoteIntervention}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-white transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Retour Superviseur
              </button>
            )}
          </div>
        </section>
      )}

      {/* Crisp Split Visual Header + Pharmacy Selector & Quota Controls */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-8 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label htmlFor="pharmacist-office-select" className="block text-xs font-medium text-slate-400">
                    Officine connectée
                  </label>
                  {lockedPharmacy && selectedPharmacy ? (
                    <div className="mt-1 flex h-9 items-center rounded-lg border border-emerald-800/60 bg-slate-950 px-3 text-sm font-semibold text-slate-100">
                      {selectedPharmacy.name} — {selectedPharmacy.city}
                    </div>
                  ) : (
                    <select
                      id="pharmacist-office-select"
                      value={selectedPharmacyId}
                      onChange={(e) => onChangePharmacyId(e.target.value)}
                      className="mt-1 h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-slate-100 focus:border-emerald-500 focus:outline-none"
                    >
                      {pharmacies.map((ph) => (
                        <option key={ph.id} value={ph.id}>
                          {ph.name} — {ph.city}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedPharmacy && (
                  <div className="border-l border-slate-800 pl-4 text-xs space-y-1.5 min-w-[230px]">
                    <div className="font-medium text-slate-200">{selectedPharmacy.pharmacist}</div>
                    <div className="text-slate-400">
                      Clé :{' '}
                      <span className="font-mono font-semibold text-emerald-400">
                        {selectedPharmacy.agentKey}
                      </span>{' '}
                      · {selectedPharmacy.targetSoftware}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-[11px] tabular-nums">
                        <span className="inline-flex items-center gap-1.5 text-slate-300">
                          <Coins className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span>
                            Forfait <strong>{planName}</strong> ({planDailyPace})
                          </span>
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            quotaPct >= 100
                              ? 'text-red-400'
                              : quotaPct >= 80
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {quotaPct}% utilisé · {quotaLeftPct}% libre
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all ${
                            selectedPharmacy.subscriptionStatus === 'suspended' || quotaPct >= 100
                              ? 'bg-red-500'
                              : quotaPct >= 80
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${quotaPct}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                        <span>0 % facturé en cas d’échec</span>
                        {isAuthenticated && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowQuotaRequestPanel((v) => !v);
                              setQuotaReqError(null);
                              setQuotaReqSuccess(null);
                            }}
                            className="inline-flex items-center gap-1 font-semibold text-emerald-400 hover:text-emerald-300 whitespace-nowrap"
                          >
                            <ArrowUpCircle className="h-3 w-3" />
                            Recharger / Augmenter
                          </button>
                        )}
                        {selectedPharmacy.subscriptionStatus === 'suspended' && (
                          <span className="font-semibold text-red-400">· Accès suspendu</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {authSession ? (
                  <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-semibold ${
                        authSession.user.role === 'titulaire'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                          : authSession.user.role === 'adjoint'
                          ? 'bg-amber-950 text-amber-300 border border-amber-700/60'
                          : 'bg-sky-950 text-sky-300 border border-sky-700/60'
                      }`}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      {ROLE_LABELS[authSession.user.role]}
                    </span>
                    <span className="font-medium text-slate-100">{authSession.user.fullName}</span>
                    <span className="font-mono text-slate-400">@{authSession.user.loginId}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPasswordForm((v) => !v);
                        setPwdError(null);
                        setPwdSuccess(null);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                    >
                      <KeyRound className="h-3 w-3" />
                      Mot de passe
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:border-red-500/60 hover:text-red-300"
                    >
                      <LogOut className="h-3 w-3" />
                      Déconnexion
                    </button>
                  </div>
                ) : isOwnerActing && ownerSession ? (
                  <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-emerald-800/60 bg-slate-950 px-3 py-1.5 text-xs">
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-950 border border-emerald-700/60 px-2 py-0.5 font-semibold text-emerald-300">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Superviseur
                    </span>
                    <span className="font-medium text-slate-100">{ownerSession.owner.fullName}</span>
                    <button
                      type="button"
                      onClick={() => setForcePharmacyLogin(true)}
                      className="ml-1 inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:border-sky-500 hover:text-sky-300"
                    >
                      <Users className="h-3 w-3" />
                      Tester un rôle officine
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    Connexion requise par ID &amp; Mot de passe
                    {ownerSession && !lockedPharmacy && forcePharmacyLogin && (
                      <button
                        type="button"
                        onClick={() => setForcePharmacyLogin(false)}
                        className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 hover:border-emerald-500"
                      >
                        Revenir en mode Superviseur
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Provisional Password Warning / Self-Service Password Change Form */}
            {authSession && (authSession.user.mustChangePassword || showPasswordForm) && (
              <div className="mt-4 rounded-lg border border-amber-800/70 bg-amber-950/25 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
                    <KeyRound className="h-4 w-4 shrink-0" />
                    {authSession.user.mustChangePassword
                      ? 'Mot de passe provisoire détecté : personnalisez votre mot de passe pour sécuriser ce compte.'
                      : 'Modifier votre mot de passe personnel'}
                  </div>
                  {!authSession.user.mustChangePassword && (
                    <button
                      type="button"
                      onClick={() => setShowPasswordForm(false)}
                      className="text-[11px] text-slate-400 hover:text-slate-200"
                    >
                      Fermer
                    </button>
                  )}
                </div>

                <form
                  onSubmit={handleChangeOwnPassword}
                  className="grid grid-cols-1 gap-2.5 sm:grid-cols-4 items-end"
                >
                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Mot de passe actuel
                    </label>
                    <input
                      type="password"
                      required
                      value={currentPwdInput}
                      onChange={(e) => setCurrentPwdInput(e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Nouveau mot de passe (min. 6)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newPwdInput}
                      onChange={(e) => setNewPwdInput(e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Confirmer le nouveau mot de passe
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={confirmPwdInput}
                      onChange={(e) => setConfirmPwdInput(e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <button
                      type="submit"
                      disabled={pwdSaving}
                      className="h-9 w-full rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {pwdSaving ? 'Enregistrement...' : 'Enregistrer le mot de passe'}
                    </button>
                  </div>
                </form>
                {pwdError && <p className="text-xs text-red-300">{pwdError}</p>}
              </div>
            )}

            {pwdSuccess && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/50 px-3.5 py-2 text-xs text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{pwdSuccess}</span>
              </div>
            )}

            {/* Closed-Loop Quota Top-Up / Upgrade Request Panel */}
            {isAuthenticated && showQuotaRequestPanel && selectedPharmacy && (
              <div className="mt-4 rounded-xl border border-emerald-800/70 bg-slate-950/95 p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                    <ArrowUpCircle className="h-4 w-4 shrink-0" />
                    <span>
                      Augmenter votre capacité IA ou changer de forfait ({quotaPct} % utilisé
                      actuellement)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQuotaRequestPanel(false)}
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <form
                  onSubmit={handleSubmitQuotaRequest}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end"
                >
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Option de renouvellement souhaitée
                    </label>
                    <select
                      value={requestedQuotaKind}
                      onChange={(e) => setRequestedQuotaKind(e.target.value as QuotaRequestKind)}
                      className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="topup_25">Recharge ponctuelle +25 % de capacité</option>
                      <option value="topup_50">Recharge ponctuelle +50 % (Pic d’activité)</option>
                      <option value="upgrade_pro">Passer au forfait Pro (~10 BL/j · 75 000 F)</option>
                      <option value="upgrade_enterprise">
                        Passer au forfait Réseau (~15-20 BL/j · 135 000 F)
                      </option>
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Note au superviseur (optionnel)
                    </label>
                    <input
                      type="text"
                      value={quotaRequestNote}
                      onChange={(e) => setQuotaRequestNote(e.target.value)}
                      placeholder="Ex: Arrivage grossiste exceptionnel..."
                      className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={sendingQuotaReq}
                      className="h-9 w-full rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {sendingQuotaReq ? 'Envoi...' : 'Envoyer la demande'}
                    </button>
                  </div>
                </form>

                {quotaReqError && <p className="text-xs text-red-300">{quotaReqError}</p>}
                {quotaReqSuccess && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/60 px-3 py-2 text-xs text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{quotaReqSuccess}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
                  <span>
                    Besoin d’un déblocage immédiat ? Contactez directement Dr. Oumar (Sénégal) :
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href="tel:+221774144799"
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 font-mono text-slate-200 hover:border-emerald-500"
                    >
                      <Phone className="h-3 w-3 text-emerald-400" />
                      +221 77 414 47 99
                    </a>
                    <a
                      href={`mailto:oumarmaiil@gmail.com?subject=${encodeURIComponent(
                        `PharmAgent — Demande de recharge (${selectedPharmacy.name})`
                      )}`}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-200 hover:border-sky-500"
                    >
                      <Mail className="h-3 w-3 text-sky-400" />
                      oumarmaiil@gmail.com
                    </a>
                  </div>
                </div>

                {pharmacyRequests.length > 0 && (
                  <div className="border-t border-slate-800/80 pt-2.5 space-y-1">
                    <div className="text-[11px] font-medium text-slate-400">
                      Vos demandes récentes
                    </div>
                    {pharmacyRequests.slice(0, 3).map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300"
                      >
                        <span>
                          {r.requestedKind === 'topup_25'
                            ? 'Recharge +25 %'
                            : r.requestedKind === 'topup_50'
                            ? 'Recharge +50 %'
                            : r.requestedKind === 'upgrade_pro'
                            ? 'Passage forfait Pro'
                            : 'Passage forfait Réseau'}{' '}
                          · <span className="text-slate-500">{new Date(r.createdAt).toLocaleDateString('fr-FR')}</span>
                        </span>
                        <span
                          className={`font-semibold ${
                            r.status === 'APPROUVEE'
                              ? 'text-emerald-400'
                              : r.status === 'REFUSEE'
                              ? 'text-red-400'
                              : 'text-amber-300'
                          }`}
                        >
                          {r.status === 'APPROUVEE'
                            ? 'Approuvée et créditée'
                            : r.status === 'REFUSEE'
                            ? 'Refusée'
                            : 'En attente de validation'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-4 relative min-h-[175px] border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950 overflow-hidden">
            <PanelIllustration variant="workspace" label="Espace de travail PharmAgent" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent flex items-end p-4">
              <div className="text-[11px] text-slate-200 leading-snug">
                <div className="font-semibold text-emerald-300">Poste Officine PharmAgent</div>
                <div className="text-slate-300">
                  Extraction IA sécurisée · Brouillon contrôlé avant validation finale
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Preventive 80% or Hard-Stop 100% Alert Banner */}
      {isAuthenticated && selectedPharmacy && (quotaPct >= 80 || selectedPharmacy.subscriptionStatus === 'suspended') && (
        <section
          className={`rounded-xl border px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 ${
            selectedPharmacy.subscriptionStatus === 'suspended' || quotaPct >= 100
              ? 'border-red-800/80 bg-red-950/35 text-red-200'
              : 'border-amber-700/70 bg-amber-950/30 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2.5 text-xs">
            <AlertTriangle
              className={`h-4 w-4 shrink-0 ${
                selectedPharmacy.subscriptionStatus === 'suspended' || quotaPct >= 100
                  ? 'text-red-400'
                  : 'text-amber-400'
              }`}
            />
            <span>
              {selectedPharmacy.subscriptionStatus === 'suspended'
                ? 'Accès officine suspendu par le Superviseur. Contactez Dr. Oumar (+221 77 414 47 99).'
                : quotaPct >= 100
                ? 'Capacité mensuelle à 100 % — Aucune tâche ne peut démarrer tant qu’une recharge n’est pas validée (0 % facturé sur les blocages).'
                : `Alerte préventive : ${quotaPct} % de votre capacité mensuelle utilisée (${quotaLeftPct} % disponible). Anticipez avec une recharge +25 % ou +50 %.`}
            </span>
          </div>
          {selectedPharmacy.subscriptionStatus !== 'suspended' && (
            <button
              type="button"
              onClick={() => setShowQuotaRequestPanel(true)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                quotaPct >= 100
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              }`}
            >
              <ArrowUpCircle className="h-3.5 w-3.5" />
              Demander une recharge / augmenter
            </button>
          )}
        </section>
      )}

      {!isAuthenticated ? (
        <PharmacyLoginCard
          pharmacy={selectedPharmacy}
          pharmacyId={selectedPharmacyId}
          authChecking={authChecking}
          onAuthenticated={(session) => {
            setAuthSession(session);
            setForcePharmacyLogin(false);
            onPortalAuthChange?.(session);
            setWorkspaceSubTab('drafts');
          }}
        />
      ) : (
        <>

      {/* Main Pharmacist Cockpit: Camera + Mission + Target */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Real Camera & Photo Input */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-5 flex flex-col">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-100">
              1. Document photographié
            </h2>
            <p className="text-xs text-slate-400">
              Utilisez votre caméra ou importez une photo de bon, facture ou mutuelle
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-white transition-colors"
              >
                <Camera className="h-4 w-4" />
                Ouvrir la caméra
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <Square className="h-3.5 w-3.5 text-red-500" />
                Fermer caméra
              </button>
            )}

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors">
              <Upload className="h-4 w-4" />
              Importer / Photo mobile
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handlePhotoUpload(e.target.files?.[0])}
              />
            </label>
          </div>

          {cameraError && (
            <div className="mb-3 rounded-lg border border-amber-800/70 bg-amber-950/50 p-3 text-xs text-amber-300">
              {cameraError}
            </div>
          )}

          <div className="relative flex-1 min-h-[280px] flex items-center justify-center rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
            {cameraActive ? (
              <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full max-h-[340px] object-contain"
                />
                <button
                  type="button"
                  onClick={capturePhotoFromCamera}
                  className="mt-3 mb-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <Camera className="h-4 w-4" />
                  Capturer le document
                </button>
              </div>
            ) : photoPreview || sampleFallbackPath ? (
              <img
                src={photoPreview || sampleFallbackPath || ''}
                alt="Document officine à traiter"
                referrerPolicy="no-referrer"
                className="max-h-[360px] w-auto object-contain"
              />
            ) : (
              <div className="p-6 text-center">
                <Camera className="mx-auto h-9 w-9 text-slate-600" />
                <p className="mt-2 text-xs font-medium text-slate-300">
                  Aucune photo chargée pour l’instant
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Ouvrez la caméra ou utilisez une démo documentaire ci-dessous :
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoPreview(null);
                      setSampleFallbackPath('/src/assets/images/sample_bon_livraison_1795017387838.jpg');
                      setDocumentHint('bon_livraison');
                    }}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500 hover:text-emerald-400"
                  >
                    Démo Bon de livraison
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoPreview(null);
                      setSampleFallbackPath('/src/assets/images/sample_facture_mutuelle_1795017386332.jpg');
                      setDocumentHint('mutuelle');
                    }}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500 hover:text-emerald-400"
                  >
                    Démo Facture Mutuelle
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Clickable Document Vignettes Strip (Always Visible) */}
          <div className="mt-3">
            <div className="text-[11px] font-medium text-slate-400 mb-2">
              Vignettes rapides (charger un document type)
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                {
                  label: 'Bon de livraison',
                  sub: 'Répartiteur (Démo)',
                  hint: 'bon_livraison' as DocumentCategory,
                  src: '/src/assets/images/sample_bon_livraison_1795017387838.jpg',
                },
                {
                  label: 'Facture Mutuelle',
                  sub: 'Tiers payant (Démo)',
                  hint: 'mutuelle' as DocumentCategory,
                  src: '/src/assets/images/sample_facture_mutuelle_1795017386332.jpg',
                },
              ].map((doc) => {
                const isSelected = !photoPreview && sampleFallbackPath === doc.src;
                return (
                  <button
                    key={doc.src}
                    type="button"
                    onClick={() => {
                      stopCamera();
                      setPhotoPreview(null);
                      setSampleFallbackPath(doc.src);
                      setDocumentHint(doc.hint);
                      setTaskError(null);
                    }}
                    className={`flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-950/40'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-600'
                    }`}
                  >
                    <img
                      src={doc.src}
                      alt={doc.label}
                      referrerPolicy="no-referrer"
                      className="h-11 w-14 shrink-0 rounded object-cover border border-slate-800"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-100">{doc.label}</div>
                      <div className="truncate text-[11px] text-slate-400">{doc.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Mission Prompt & Real Execution Target */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-7 flex flex-col justify-between space-y-5">
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                2. Donner une tâche à l’agent
              </h2>
              <p className="text-xs text-slate-400">
                L’agent applique automatiquement sa mémoire apprise pour extraire et remplir la cible
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Type de document
                </label>
                <select
                  value={documentHint}
                  onChange={(e) => setDocumentHint(e.target.value as DocumentCategory)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-medium text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="bon_livraison">Bon de livraison grossiste</option>
                  <option value="facture">Facture fournisseur / Facture SDR (Eau, Élec...)</option>
                  <option value="mutuelle">Bordereau / Facture mutuelle</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Instruction pour l’agent
                </label>
                <textarea
                  rows={2}
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  placeholder="Ex: Extrais N° Compteur, Consommation, Coût, Adresse, Ville et remplis mon fichier Excel..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                'Facture SDR : extrais N° Facture, N° Compteur, Consommation, Coût, Adresse, Ville et remplis le fichier Excel en Brouillon.',
                'Remplis mon tableau Excel avec les colonnes exactes et arrête-toi au Brouillon.',
                'Prépare le brouillon d’entrée en stock et signale les lots qui expirent avant 2028.',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTaskPrompt(preset)}
                  className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-400 hover:border-emerald-600 hover:text-emerald-300 transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Real Execution Target Selector */}
            <div>
              <div className="text-xs font-medium text-slate-300 mb-2">
                3. Où l’agent doit-il exécuter cette tâche ?
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setTargetMode('excel_upload')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    targetMode === 'excel_upload'
                      ? 'border-emerald-500 bg-emerald-950/40'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className="mb-2 h-14 w-full overflow-hidden rounded border border-slate-800 bg-slate-900">
                    <img
                      src="/src/assets/images/target_excel_screenshot_1795017389210.jpg"
                      alt="Vignette Tableur Excel"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover opacity-90"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />
                    Excel (.xlsx) — Navigateur
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Aucune installation requise. Lit vos colonnes, remplit en Brouillon et apprend le format.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTargetMode('erp_live')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    targetMode === 'erp_live'
                      ? 'border-emerald-500 bg-emerald-950/40'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className="mb-2 h-14 w-full overflow-hidden rounded border border-slate-800 bg-slate-900">
                    <img
                      src="/src/assets/images/target_erp_screenshot_1795017387811.jpg"
                      alt="Vignette ERP Officine Intégré"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover opacity-90"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                    <PackageCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                    ERP Intégré — Navigateur
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Aucune installation requise. Crée un brouillon persistant prêt pour validation.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTargetMode('local_desktop')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    targetMode === 'local_desktop'
                      ? 'border-emerald-500 bg-emerald-950/40'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className="mb-2 flex h-14 w-full items-center justify-center rounded border border-slate-800 bg-slate-900 text-emerald-400">
                    <Laptop className="h-6 w-6" />
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                    <Laptop className="h-4 w-4 text-emerald-400 shrink-0" />
                    Logiciel Local (PC / Mac)
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Uniquement pour piloter un logiciel hors navigateur (démarrage automatique au boot).
                  </p>
                </button>
              </div>

              {targetMode === 'excel_upload' && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="text-xs text-slate-300">
                    {uploadedExcelName ? (
                      <span>
                        Classeur chargé :{' '}
                        <strong className="font-mono text-emerald-400">{uploadedExcelName}</strong>
                      </span>
                    ) : (
                      <span>Importez votre classeur Excel (.xlsx) ou chargez le modèle test :</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleLoadProposedExcelTemplate('facture_sdr')}
                      className="inline-flex items-center gap-1 rounded-lg border border-cyan-700/70 bg-cyan-950/40 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300 hover:border-cyan-400"
                    >
                      <FileSpreadsheet className="h-3 w-3 text-cyan-400" />
                      Modèle Facture SDR (.xlsx)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoadProposedExcelTemplate('custom_kit')}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:border-emerald-500 hover:text-emerald-300"
                    >
                      <FileSpreadsheet className="h-3 w-3 text-emerald-400" />
                      Modèle Officine (.xlsx)
                    </button>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-950/60 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/60">
                      <Upload className="h-3.5 w-3.5" />
                      {uploadedExcelName ? 'Changer .xlsx' : 'Choisir un fichier .xlsx'}
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => handleExcelUpload(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                </div>
              )}

              {targetMode === 'local_desktop' && selectedPharmacy && (
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3.5 text-[11px] text-slate-300 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-400">
                      Agent Poste Local ({selectedPharmacy.targetSoftware}) — uniquement requis pour
                      piloter un logiciel PC/Mac hors navigateur :
                    </span>
                    {canLearnSoftware ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={`/api/pharmacies/${selectedPharmacy.id}/installer?token=${encodeURIComponent(effectiveToken)}`}
                          download={`pharmagent_${selectedPharmacy.id}.py`}
                          className="inline-flex items-center gap-1 rounded border border-emerald-700/70 bg-emerald-950/60 px-2 py-1 font-medium text-emerald-300 hover:bg-emerald-900/60"
                        >
                          <Download className="h-3 w-3" />
                          pharmagent_{selectedPharmacy.id}.py
                        </a>
                        <a
                          href={`/api/pharmacies/${selectedPharmacy.id}/launcher/windows?token=${encodeURIComponent(effectiveToken)}`}
                          download={`Installer_AutoStart_${selectedPharmacy.id}.bat`}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-medium text-slate-200 hover:border-emerald-500"
                          title="Installe Python/venv et configure le démarrage automatique sans terminal"
                        >
                          <Download className="h-3 w-3 text-emerald-400" />
                          Auto-Démarrage PC (.bat)
                        </a>
                        <a
                          href={`/api/pharmacies/${selectedPharmacy.id}/launcher/mac?token=${encodeURIComponent(effectiveToken)}`}
                          download={`Installer_AutoStart_${selectedPharmacy.id}.command`}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-medium text-slate-200 hover:border-sky-500"
                          title="Installe Python/venv et configure le LaunchAgent macOS automatique"
                        >
                          <Download className="h-3 w-3 text-sky-400" />
                          Auto-Démarrage Mac (.command)
                        </a>
                        <button
                          type="button"
                          onClick={() => setWorkspaceSubTab('learn_software')}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-medium text-emerald-300 hover:border-emerald-500"
                        >
                          Guide commandes pas-à-pas
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <Lock className="h-3 w-3" />
                        Installeur réservé au Titulaire
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {taskError && (
              <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-red-800 bg-red-950/60 p-3 text-xs text-red-300">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                  <span>{taskError}</span>
                </div>
                {(quotaPct >= 100 || taskError.includes('100 %') || taskError.includes('recharge')) && (
                  <button
                    type="button"
                    onClick={() => setShowQuotaRequestPanel(true)}
                    className="inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-500 whitespace-nowrap shrink-0"
                  >
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                    Demander une recharge
                  </button>
                )}
              </div>
            )}

            {actionFeedback && (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-xs text-emerald-300">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  <span>{actionFeedback}</span>
                </div>
                {lastCreatedDraft?.draftArtifactUrl && (
                  <a
                    href={`${lastCreatedDraft.draftArtifactUrl}?token=${encodeURIComponent(effectiveToken)}`}
                    download={lastCreatedDraft.draftFileName}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-500 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Télécharger .xlsx rempli
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleLaunchMission}
              disabled={runningTask}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors"
            >
              <Send className="h-4 w-4" />
              {runningTask
                ? 'L’agent analyse la photo et remplit le Brouillon...'
                : 'Exécuter la tâche (Arrêt strict au Brouillon)'}
            </button>
          </div>
        </div>
      </section>

      {/* Live Preview of Last Filled Excel Rows */}
      {lastCreatedDraft?.excelPreviewHeaders && lastCreatedDraft?.excelPreviewRows && (
        <section className="rounded-xl border border-emerald-800/70 bg-slate-900 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Aperçu direct des lignes injectées dans votre fichier Excel ({lastCreatedDraft.draftFileName})
              </h3>
              <p className="text-xs text-slate-400">
                Colonnes associées automatiquement par l’agent et mémorisées pour les prochains
                envois
              </p>
            </div>
            {lastCreatedDraft.draftArtifactUrl && (
              <a
                href={`${lastCreatedDraft.draftArtifactUrl}?token=${encodeURIComponent(effectiveToken)}`}
                download={lastCreatedDraft.draftFileName}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger le fichier Excel rempli
              </a>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-emerald-400">
                  {lastCreatedDraft.excelPreviewHeaders.map((header) => (
                    <th key={header} className="px-4 py-2.5 font-mono font-medium whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {lastCreatedDraft.excelPreviewRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40">
                    {lastCreatedDraft.excelPreviewHeaders!.map((header) => (
                      <td key={header} className="px-4 py-2.5 text-slate-200 whitespace-nowrap font-mono">
                        {String(row[header] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Bottom: Real Persisted Drafts (Human Validation) + Live Stock + Desktop Queue */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('drafts')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                workspaceSubTab === 'drafts'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Brouillons à valider ({pharmacyDrafts.filter((d) => d.status === 'BROUILLON').length})
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('stock')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                workspaceSubTab === 'stock'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Stock officine ({pharmacyStock.length})
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('desktop_queue')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                workspaceSubTab === 'desktop_queue'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              File Agent Local ({pharmacyQueue.length})
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('learn_software')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                workspaceSubTab === 'learn_software'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                  : 'text-emerald-400 hover:bg-slate-900'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              Agent Local &amp; Config (PC / Mac)
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('audit')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                workspaceSubTab === 'audit'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Journal d’audit &amp; PDF ({pharmacyAuditLogs.length})
            </button>
            {canManageUsers && (
              <button
                type="button"
                onClick={() => setWorkspaceSubTab('users')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  workspaceSubTab === 'users'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                    : 'text-slate-300 hover:bg-slate-900'
                }`}
              >
                <Users className="h-3.5 w-3.5 text-emerald-400" />
                Utilisateurs &amp; Accès ({pharmacyUsers.length})
              </button>
            )}
          </div>

          <div className="text-xs text-slate-400">
            Toute correction de nom avant validation est mémorisée par l’agent
          </div>
        </div>

        <div className="p-6">
          {workspaceSubTab === 'drafts' && (
            <div className="space-y-6">
              {pharmacyDrafts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
                  Aucun brouillon enregistré pour cette officine. Prenez une photo et lancez l’agent
                  ci-dessus.
                </div>
              ) : (
                pharmacyDrafts.map((draft) => {
                  const items = editingItemsByDraft[draft.id] || draft.extracted.lineItems;
                  const isPending = draft.status === 'BROUILLON';
                  return (
                    <div
                      key={draft.id}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-950 px-5 py-3.5">
                        <div className="flex items-start gap-3.5">
                          <img
                            src={
                              draft.extracted.documentType === 'mutuelle'
                                ? '/src/assets/images/sample_facture_mutuelle_1795017386332.jpg'
                                : '/src/assets/images/sample_bon_livraison_1795017387838.jpg'
                            }
                            alt={`Vignette ${draft.extracted.documentNumber}`}
                            referrerPolicy="no-referrer"
                            className="h-14 w-12 shrink-0 rounded-md border border-slate-800 object-cover"
                          />
                          <div>
                            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-100">
                            <span className="font-mono text-emerald-400">
                              {draft.extracted.documentNumber}
                            </span>
                            <span className="text-slate-600">·</span>
                            <span>{draft.extracted.supplierOrOrg}</span>
                            <span className="text-slate-600">·</span>
                            <span
                              className={`text-xs font-medium ${
                                draft.status === 'VALIDE_PAR_PHARMACIEN'
                                  ? 'text-emerald-400'
                                  : draft.status === 'REJETE'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {draft.status === 'VALIDE_PAR_PHARMACIEN'
                                ? `Validé par ${draft.validatedBy}`
                                : draft.status === 'REJETE'
                                ? 'Rejeté'
                                : 'BROUILLON — En attente validation pharmacien'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            Mission : {draft.taskPrompt}
                            {draft.createdBy && (
                              <span className="ml-2 text-slate-500">· Préparé par {draft.createdBy}</span>
                            )}
                            {draft.lastEditedBy && (
                              <span className="ml-2 text-sky-400">· Pré-corrigé par {draft.lastEditedBy}</span>
                            )}
                          </p>
                          {draft.extracted.agentObservations && (
                            <p className="mt-1 text-xs font-medium text-slate-300">
                              Observation agent : {draft.extracted.agentObservations}
                            </p>
                          )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {draft.draftArtifactUrl && (
                            <a
                              href={`${draft.draftArtifactUrl}?token=${encodeURIComponent(effectiveToken)}`}
                              download={draft.draftFileName}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
                            >
                              <Download className="h-3.5 w-3.5 text-emerald-400" />
                              Excel Brouillon
                            </a>
                          )}

                          {isPending && editingItemsByDraft[draft.id] && (
                            <button
                              type="button"
                              onClick={() => handleSavePreCorrections(draft)}
                              disabled={savingDraftId === draft.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-700/80 bg-sky-950/60 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-900/60 disabled:opacity-60"
                            >
                              <Save className="h-3.5 w-3.5" />
                              {savingDraftId === draft.id
                                ? 'Sauvegarde...'
                                : 'Enregistrer pré-corrections'}
                            </button>
                          )}

                          {isPending && canRejectDraft && (
                            <button
                              type="button"
                              onClick={() => handleRejectDraft(draft.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-red-700 hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Supprimer
                            </button>
                          )}

                          {isPending && canApproveDraft ? (
                            <button
                              type="button"
                              onClick={() => handleApproveDraft(draft)}
                              disabled={approvingId === draft.id}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                            >
                              <Check className="h-3.5 w-3.5" />
                              {approvingId === draft.id
                                ? 'Validation...'
                                : 'Valider Brouillon'}
                            </button>
                          ) : (
                            isPending && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-300">
                                <Lock className="h-3.5 w-3.5" />
                                Validation stock réservée au Titulaire ou Adjoint
                              </span>
                            )
                          )}
                        </div>
                      </div>

                      {/* Extracted Document Summary Strip */}
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-slate-800/80 bg-slate-900/40 px-5 py-2.5 text-[11px] text-slate-300">
                        <span>
                          <span className="text-slate-500">Date :</span>{' '}
                          <span className="font-mono">{draft.extracted.documentDate || '—'}</span>
                        </span>
                        <span>
                          <span className="text-slate-500">Total :</span>{' '}
                          <span className="font-mono font-semibold text-emerald-400 tabular-nums">
                            {Number(draft.extracted.totalAmountFCFA || 0).toLocaleString('fr-FR')}{' '}
                            {draft.extracted.currency || 'FCFA'}
                          </span>
                        </span>
                        {draft.extracted.meterNumber && (
                          <span>
                            <span className="text-slate-500">N° Compteur :</span>{' '}
                            <span className="font-mono text-cyan-300">{draft.extracted.meterNumber}</span>
                          </span>
                        )}
                        {draft.extracted.consumption && (
                          <span>
                            <span className="text-slate-500">Consommation :</span>{' '}
                            <span className="font-mono text-cyan-300">{draft.extracted.consumption}</span>
                          </span>
                        )}
                        {draft.extracted.billingPeriod && (
                          <span>
                            <span className="text-slate-500">Période :</span>{' '}
                            <span className="font-mono">{draft.extracted.billingPeriod}</span>
                          </span>
                        )}
                        {draft.extracted.customerAddress && (
                          <span>
                            <span className="text-slate-500">Adresse :</span>{' '}
                            <span>{draft.extracted.customerAddress}</span>
                          </span>
                        )}
                        {draft.extracted.customerCity && (
                          <span>
                            <span className="text-slate-500">Localité :</span>{' '}
                            <span>{draft.extracted.customerCity}</span>
                          </span>
                        )}
                        {(draft.extracted.extraFields || []).map((ef, eIdx) => (
                          <span key={eIdx}>
                            <span className="text-slate-500">{ef.key} :</span>{' '}
                            <span className="font-mono">{ef.value}</span>
                          </span>
                        ))}
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400">
                              <th className="px-4 py-2 font-medium">Désignation (DCI)</th>
                              <th className="px-4 py-2 font-medium text-right">Quantité</th>
                              <th className="px-4 py-2 font-medium">N° de lot</th>
                              <th className="px-4 py-2 font-medium">Date de péremption</th>
                              <th className="px-4 py-2 font-medium text-right">Prix unitaire (FCFA)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/80">
                            {items.map((item, idx) => (
                              <tr key={idx} className="hover:bg-slate-900/40">
                                <td className="px-4 py-2 font-medium text-slate-100">
                                  {isPending ? (
                                    <input
                                      type="text"
                                      value={item.designation}
                                      onChange={(e) =>
                                        updateDraftItemField(draft, idx, 'designation', e.target.value)
                                      }
                                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                  ) : (
                                    item.designation
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right font-mono tabular-nums">
                                  {isPending ? (
                                    <input
                                      type="number"
                                      value={item.quantity}
                                      onChange={(e) =>
                                        updateDraftItemField(
                                          draft,
                                          idx,
                                          'quantity',
                                          Number(e.target.value)
                                        )
                                      }
                                      className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                  ) : (
                                    item.quantity
                                  )}
                                </td>
                                <td className="px-4 py-2 font-mono text-slate-300">
                                  {isPending ? (
                                    <input
                                      type="text"
                                      value={item.lotNumber}
                                      onChange={(e) =>
                                        updateDraftItemField(draft, idx, 'lotNumber', e.target.value)
                                      }
                                      className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                  ) : (
                                    item.lotNumber
                                  )}
                                </td>
                                <td className="px-4 py-2 font-mono text-slate-300">
                                  {isPending ? (
                                    <input
                                      type="text"
                                      value={item.expiryDate || ''}
                                      placeholder="MM/AAAA"
                                      onChange={(e) =>
                                        updateDraftItemField(draft, idx, 'expiryDate', e.target.value)
                                      }
                                      className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                  ) : (
                                    item.expiryDate || 'N/A'
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-200">
                                  {isPending ? (
                                    <input
                                      type="number"
                                      value={item.unitPriceFCFA}
                                      onChange={(e) =>
                                        updateDraftItemField(
                                          draft,
                                          idx,
                                          'unitPriceFCFA',
                                          Number(e.target.value)
                                        )
                                      }
                                      className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                  ) : (
                                    Number(item.unitPriceFCFA).toLocaleString('fr-FR')
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {workspaceSubTab === 'stock' && (
            <div className="overflow-x-auto">
              {pharmacyStock.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Aucun article en stock pour cette officine. Validez un brouillon pour alimenter le
                  stock.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-slate-400">
                      <th className="px-4 py-2.5 font-medium">Désignation (DCI)</th>
                      <th className="px-4 py-2.5 font-medium text-right">Quantité en stock</th>
                      <th className="px-4 py-2.5 font-medium">N° de lot</th>
                      <th className="px-4 py-2.5 font-medium">Date de péremption</th>
                      <th className="px-4 py-2.5 font-medium text-right">Prix unitaire (FCFA)</th>
                      <th className="px-4 py-2.5 font-medium">Dernier document</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {pharmacyStock.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-medium text-slate-100">
                          {item.designation}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-400 tabular-nums">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">{item.lotNumber}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">{item.expiryDate}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                          {item.unitPriceFCFA.toLocaleString('fr-FR')}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-400">
                          {item.sourceDocument}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {workspaceSubTab === 'desktop_queue' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                <p className="text-xs text-slate-400">
                  File des tâches envoyées au poste Windows / Mac (actualisation automatique toutes
                  les 5 s lorsqu’une tâche est en attente)
                </p>
                <button
                  type="button"
                  onClick={onDataUpdated}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
                  Actualiser
                </button>
              </div>
              {pharmacyQueue.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Aucune tâche en attente pour l’agent desktop local.
                </p>
              ) : (
                pharmacyQueue.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="font-mono font-semibold text-slate-100">
                        {task.id} · {task.extracted.documentNumber} ({task.extracted.lineItems.length}{' '}
                        ligne(s))
                      </div>
                      <div className="text-slate-400">{task.taskPrompt}</div>
                      {task.localAgentReport && (
                        <div className="pt-1 text-emerald-300">{task.localAgentReport}</div>
                      )}
                    </div>
                    <span
                      className={`font-mono font-medium shrink-0 ${
                        task.status === 'BROUILLON_CREE_LOCALEMENT'
                          ? 'text-emerald-400'
                          : task.status === 'BLOQUE_GARDE_FOU'
                          ? 'text-red-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {task.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {workspaceSubTab === 'learn_software' && (
            <div className="space-y-6" onPaste={handleLearnPaste}>
              <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/50 p-5">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    1. Apprendre visuellement un logiciel local (Windows / Mac)
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    PC :{' '}
                    <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                      Win + Shift + S
                    </kbd>{' '}
                    puis{' '}
                    <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                      Ctrl + V
                    </kbd>{' '}
                    · Mac :{' '}
                    <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                      Cmd + Ctrl + Shift + 4
                    </kbd>{' '}
                    puis{' '}
                    <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                      Cmd + V
                    </kbd>
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                  <div className="lg:col-span-8 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={learnSoftwareName}
                        onChange={(e) => setLearnSoftwareName(e.target.value)}
                        placeholder={
                          selectedPharmacy?.targetSoftware || 'Nom du logiciel (ex: Logiciel Comptoir)'
                        }
                        className="h-9 flex-1 min-w-[200px] rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                      <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0">
                        <Upload className="h-3.5 w-3.5" />
                        Importer capture (.png/.jpg)
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleLearnScreenshotFile(e.target.files?.[0])}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleAnalyzeAndLearnSoftware(canLearnSoftware)}
                        disabled={
                          !learnScreenshotBase64 ||
                          learningGroundLoading ||
                          learningSaveLoading ||
                          !canLearnSoftware
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <BookmarkCheck className="h-3.5 w-3.5" />
                        {!canLearnSoftware
                          ? 'Réservé au Titulaire'
                          : learningGroundLoading || learningSaveLoading
                          ? 'Analyse & Mémorisation...'
                          : 'Analyser & Mémoriser pour de bon'}
                      </button>
                    </div>

                    {!canLearnSoftware && (
                      <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-300">
                        Seul le Pharmacien titulaire ou le Propriétaire peut configurer un logiciel
                        PC/Mac ou télécharger l’installeur .py.
                      </div>
                    )}

                    <div className="relative min-h-[240px] rounded-lg border border-dashed border-slate-700 bg-slate-950 flex items-center justify-center overflow-hidden p-2">
                      {!learnScreenshotBase64 ? (
                        <div className="text-center p-6">
                          <Crosshair className="mx-auto h-8 w-8 text-slate-600" />
                          <p className="mt-2 text-xs font-medium text-slate-300">
                            Cliquez ici puis faites Ctrl + V / Cmd + V pour coller votre capture
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Ou utilisez « Importer capture » ci-dessus.
                          </p>
                        </div>
                      ) : (
                        <div className="relative w-full">
                          <img
                            src={learnScreenshotBase64}
                            alt="Capture logiciel à apprendre"
                            className="w-full h-auto rounded border border-slate-800"
                          />
                          {learnGroundingResult && (
                            <div className="pointer-events-none absolute inset-0">
                              {learnGroundingResult.elements.map((el) => {
                                const [ymin, xmin, ymax, xmax] = el.box_2d;
                                const isForbidden = el.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL';
                                const isDraft = el.safetyStatus === 'AUTHORIZED_DRAFT_SAVE';
                                return (
                                  <div
                                    key={el.id}
                                    style={{
                                      top: `${ymin / 10}%`,
                                      left: `${xmin / 10}%`,
                                      width: `${Math.max(2, (xmax - xmin) / 10)}%`,
                                      height: `${Math.max(2, (ymax - ymin) / 10)}%`,
                                    }}
                                    className={`absolute border-2 ${
                                      isForbidden
                                        ? 'border-red-500 bg-red-500/20'
                                        : isDraft
                                        ? 'border-amber-400 bg-amber-400/20'
                                        : 'border-emerald-500 bg-emerald-500/15'
                                    }`}
                                  >
                                    <span
                                      className={`absolute -top-4 left-0 whitespace-nowrap rounded px-1 font-mono text-[9px] text-white ${
                                        isForbidden
                                          ? 'bg-red-600'
                                          : isDraft
                                          ? 'bg-amber-600'
                                          : 'bg-emerald-700'
                                      }`}
                                    >
                                      {isForbidden ? `BLOQUÉ: ${el.detectedLabel}` : el.detectedLabel}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="lg:col-span-4 space-y-3">
                    {learnError && (
                      <div className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-xs text-red-300">
                        {learnError}
                      </div>
                    )}
                    {learnFeedback && (
                      <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-xs text-emerald-300">
                        {learnFeedback}
                      </div>
                    )}

                    {learnGroundingResult ? (
                      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 max-h-72 overflow-y-auto space-y-1.5 text-xs">
                        <div className="font-semibold text-slate-300 mb-1">
                          Zones détectées ({learnGroundingResult.elements.length})
                        </div>
                        {learnGroundingResult.elements.map((el) => (
                          <div
                            key={el.id}
                            className="flex items-center justify-between gap-2 border-b border-slate-800/70 pb-1 last:border-0"
                          >
                            <span className="truncate text-slate-200">{el.detectedLabel}</span>
                            {el.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-red-400 shrink-0">
                                <Lock className="h-3 w-3" />
                                Bloqué
                              </span>
                            ) : (
                              <span className="font-mono text-[10px] text-emerald-400 shrink-0 tabular-nums">
                                ({el.centerPoint.x}, {el.centerPoint.y})
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400 space-y-2">
                        <div className="font-semibold text-slate-200">
                          Comment mémoriser votre logiciel ?
                        </div>
                        <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
                          <li>Ouvrez votre logiciel métier sur l’écran de saisie.</li>
                          <li>Collez la capture à gauche.</li>
                          <li>
                            Cliquez sur <strong>Analyser &amp; Mémoriser pour de bon</strong> : les
                            champs sont repérés et les boutons de validation finale sont verrouillés.
                          </li>
                        </ol>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-100 mb-3">
                  2. Installer Python (PC / Mac neuf) &amp; configurer le démarrage automatique
                </h3>
                <DesktopAgentSetupGuide
                  pharmacy={selectedPharmacy}
                  token={effectiveToken}
                  canDownloadScripts={canLearnSoftware}
                />
              </div>
            </div>
          )}
          {workspaceSubTab === 'users' && canManageUsers && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Gestion des utilisateurs de l’officine ({selectedPharmacy?.name})
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Créez des accès avec Identifiant (ID) et mot de passe provisoire pour vos{' '}
                    <span className="text-emerald-400 font-medium">Pharmaciens titulaires</span>,{' '}
                    <span className="text-amber-400 font-medium">Pharmaciens adjoints / Gérants</span> et{' '}
                    <span className="text-sky-400 font-medium">Assistants / Préparateurs</span>.
                  </p>
                </div>
              </div>

              {usersError && (
                <div className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-xs text-red-300">
                  {usersError}
                </div>
              )}
              {usersFeedback && (
                <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-xs text-emerald-300">
                  {usersFeedback}
                </div>
              )}

              <form
                onSubmit={handleCreateUser}
                className="rounded-lg border border-slate-800 bg-slate-950 p-4 grid grid-cols-1 gap-3 md:grid-cols-12 items-end"
              >
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Identifiant (ID)
                  </label>
                  <input
                    type="text"
                    required
                    value={newUserLoginId}
                    onChange={(e) => setNewUserLoginId(e.target.value)}
                    placeholder="ex: operateur.comptoir"
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Nom complet
                  </label>
                  <input
                    type="text"
                    required
                    value={newUserFullName}
                    onChange={(e) => setNewUserFullName(e.target.value)}
                    placeholder="ex: Dr. Adjoint ou Assistant"
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Niveau d’accès
                  </label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as PharmacyUserRole)}
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="assistant">Assistant / Préparateur</option>
                    <option value="adjoint">Pharmacien adjoint / Gérant</option>
                    <option value="titulaire">Pharmacien titulaire</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Mot de passe provisoire
                  </label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Min. 4 caractères"
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={creatingUser}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    {creatingUser ? 'Création...' : 'Créer compte'}
                  </button>
                </div>
              </form>

              <div className="overflow-x-auto rounded-lg border border-slate-800">
                {usersLoading ? (
                  <p className="p-6 text-center text-xs text-slate-400">
                    Chargement des comptes de l’officine...
                  </p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950 text-slate-400">
                        <th className="px-4 py-2.5 font-medium">Identifiant (ID)</th>
                        <th className="px-4 py-2.5 font-medium">Nom complet</th>
                        <th className="px-4 py-2.5 font-medium">Niveau d’accès</th>
                        <th className="px-4 py-2.5 font-medium">Mot de passe</th>
                        <th className="px-4 py-2.5 font-medium">Statut</th>
                        <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {pharmacyUsers.map((u) => {
                        const isSelf = authSession?.user.id === u.id;
                        return (
                          <tr key={u.id} className="hover:bg-slate-800/40">
                            <td className="px-4 py-2.5 font-mono font-semibold text-slate-100">
                              @{u.loginId}
                              {isSelf && (
                                <span className="ml-2 text-[10px] font-sans text-emerald-400">
                                  (vous)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-slate-200">{u.fullName}</td>
                            <td className="px-4 py-2.5">
                              <select
                                value={u.role}
                                disabled={isSelf}
                                onChange={(e) =>
                                  handleChangeUserRole(u, e.target.value as PharmacyUserRole)
                                }
                                className="h-7 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-slate-100 disabled:opacity-60"
                              >
                                <option value="titulaire">Pharmacien titulaire</option>
                                <option value="adjoint">Pharmacien adjoint / Gérant</option>
                                <option value="assistant">Assistant / Préparateur</option>
                              </select>
                            </td>
                            <td className="px-4 py-2.5">
                              {u.mustChangePassword ? (
                                <span className="inline-flex items-center rounded bg-amber-950 border border-amber-800/70 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                  Provisoire
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded bg-slate-900 border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                  Personnalisé
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <button
                                type="button"
                                disabled={isSelf}
                                onClick={() => handleToggleUserActive(u)}
                                className={`rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-60 ${
                                  u.active
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/70'
                                    : 'bg-red-950 text-red-300 border border-red-800/70'
                                }`}
                              >
                                {u.active ? 'Actif' : 'Suspendu'}
                              </button>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-2">
                                {resetPasswordUserId === u.id ? (
                                  <div className="inline-flex items-center gap-1">
                                    <input
                                      type="password"
                                      value={resetPasswordValue}
                                      onChange={(e) => setResetPasswordValue(e.target.value)}
                                      placeholder="Nouveau mot de passe"
                                      className="h-7 w-36 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-slate-100"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSaveResetPassword(u.id)}
                                      className="h-7 rounded bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-500"
                                    >
                                      OK
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setResetPasswordUserId(null);
                                        setResetPasswordValue('');
                                      }}
                                      className="h-7 rounded border border-slate-700 px-2 text-[11px] text-slate-300"
                                    >
                                      Annuler
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setResetPasswordUserId(u.id);
                                      setResetPasswordValue('');
                                    }}
                                    className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200 hover:border-slate-500"
                                  >
                                    Réinitialiser mdp
                                  </button>
                                )}

                                {!isSelf && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteUser(u)}
                                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:border-red-700 hover:text-red-300"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    Supprimer
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
          {workspaceSubTab === 'audit' && (
            <AuditLogView
              logs={pharmacyAuditLogs}
              pharmacies={selectedPharmacy ? [selectedPharmacy] : []}
              defaultPharmacyId={selectedPharmacyId}
              lockedPharmacy
              canExportPdf={canExportOfficialPdf}
              signatoryName={
                authSession?.user
                  ? `${authSession.user.fullName} (@${authSession.user.loginId})`
                  : isOwnerActing && ownerSession
                  ? `${ownerSession.owner.fullName} (Propriétaire)`
                  : selectedPharmacy?.pharmacist
              }
            />
          )}
        </div>
      </section>
        </>
      )}
    </div>
  );
};
