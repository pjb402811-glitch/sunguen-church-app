import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp, type FirebaseApp } from '@firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, signInAnonymously, updatePassword, reauthenticateWithCredential, EmailAuthProvider, type Auth, type User } from '@firebase/auth';
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, onSnapshot, orderBy, limit, writeBatch, type Firestore } from '@firebase/firestore';
import { GoogleGenAI, Type } from "@google/genai";

// Global variables declaration
declare const __app_id: string;
declare const __firebase_config: string;
declare const __admin_user_id: string;
declare const __admin_email: string;

// --- Firebase Context & Provider ---

interface FirebaseContextType {
  app: FirebaseApp | null;
  db: Firestore | null;
  auth: Auth | null;
  user: User | null;
  userId: string | null;
  isAdmin: boolean;
  isAnonymous: boolean;
  isAuthReady: boolean;
  appId: string;
  isOnline: boolean;
  logout: () => Promise<void>;
  newContent: { [key: string]: boolean };
  markAsRead: (collectionName: string) => void;
}

const FirebaseContext = createContext<FirebaseContextType | null>(null);

function FirebaseProvider({ children }: { children?: React.ReactNode }) {
  const [app, setApp] = useState<FirebaseApp | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [newContent, setNewContent] = useState<{ [key: string]: boolean }>({});
  const [latestTimestamps, setLatestTimestamps] = useState<{ [key: string]: number }>({});

  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    try {
      const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
      const adminId = typeof __admin_user_id !== 'undefined' ? __admin_user_id : null;

      if (!Object.keys(firebaseConfig).length || firebaseConfig.apiKey === "YOUR_API_KEY") {
        console.error("Firebase config is missing or using placeholder values.");
        setIsAuthReady(true);
        return;
      }
      
      const firebaseApp = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(firebaseApp);
      const firebaseAuth = getAuth(firebaseApp);

      setApp(firebaseApp);
      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          setUserId(currentUser.uid);
          setIsAnonymous(currentUser.isAnonymous);
          const isAdminUser = !!(adminId && currentUser.uid === adminId && adminId !== 'PASTE_YOUR_ADMIN_UID_HERE');
          setIsAdmin(isAdminUser);
        } else {
          setUser(null);
          setUserId(null);
          setIsAdmin(false);
          setIsAnonymous(true);
          try {
            await signInAnonymously(firebaseAuth);
          } catch (error) {
            console.error("Failed to sign in anonymously:", error);
          }
        }
        setIsAuthReady(true);
      });
      
      const contentCollections = ['sermons', 'columns', 'announcements', 'prayers'];
      const unsubscribers = contentCollections.map(collectionName => {
        const q = query(collection(firestoreDb, collectionName), orderBy('timestamp', 'desc'), limit(1));
        return onSnapshot(q, (querySnapshot) => {
          try {
            if (querySnapshot.empty) {
                setNewContent(prev => ({ ...prev, [collectionName]: false }));
                return;
            }

            const latestDoc = querySnapshot.docs[0];
            const postData = latestDoc.data();

            if (!postData || latestDoc.metadata.hasPendingWrites || !postData.timestamp || typeof postData.timestamp.toMillis !== 'function') {
                return; 
            }

            const latestTimestamp = postData.timestamp.toMillis();
            
            if (isNaN(latestTimestamp)) return;

            setLatestTimestamps(prev => ({ ...prev, [collectionName]: latestTimestamp }));
            const seenTimestampRaw = localStorage.getItem(`seenTimestamp_${collectionName}`);
            const seenTimestamp = seenTimestampRaw ? parseInt(seenTimestampRaw, 10) : 0;

            if (latestTimestamp > seenTimestamp) {
                setNewContent(prev => ({ ...prev, [collectionName]: true }));
            } else {
                setNewContent(prev => ({ ...prev, [collectionName]: false }));
            }
          } catch (error) {
              console.error(`Error processing snapshot for ${collectionName}:`, error);
              setNewContent(prev => ({ ...prev, [collectionName]: false }));
          }
        });
      });

      if (!firebaseAuth.currentUser) {
          signInAnonymously(firebaseAuth).catch(error => {
              console.error("Initial anonymous sign-in failed:", error);
          });
      }

      return () => {
        unsubscribeAuth();
        unsubscribers.forEach(unsub => unsub());
      };
    } catch (e) {
        console.error("Error initializing Firebase:", e);
        setIsAuthReady(true);
    }
  }, []);

  const markAsRead = (collectionName: string) => {
    if (newContent[collectionName]) {
        setNewContent(prev => ({ ...prev, [collectionName]: false }));
        const latestTimestamp = latestTimestamps[collectionName];
        if (latestTimestamp) {
            localStorage.setItem(`seenTimestamp_${collectionName}`, latestTimestamp.toString());
        }
    }
  };
  
  const logout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const contextValue: FirebaseContextType = {
    app, db, auth, user, userId, isAdmin, isAnonymous, isAuthReady, appId, isOnline, logout, newContent, markAsRead
  };

  return (
    <FirebaseContext.Provider value={contextValue}>
      {children}
    </FirebaseContext.Provider>
  );
}

function useFirebase() {
  const context = useContext(FirebaseContext);
  if (!context) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
}

// --- Data Types ---

interface Post {
  id: string;
  title: string;
  content: string;
  timestamp: any;
  author?: string;
  date?: string;
  bibleVerse?: string;
}

// --- Components ---

// IOS Install Instructions Modal
function IosInstallModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
      <div className="bg-[#1F2937] rounded-xl max-w-sm w-full shadow-2xl overflow-hidden border border-gray-700 relative p-6">
        <button 
            onClick={onClose} 
            className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors focus:outline-none"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>

        <h3 className="text-xl font-bold text-white mb-4 text-center">아이폰에 앱 설치하기</h3>
        
        <div className="space-y-4 text-gray-300 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 bg-gray-700 p-2 rounded-lg">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
               </svg>
            </div>
            <div>
              <p className="font-semibold text-white">1단계</p>
              <p>사파리(Safari) 브라우저 하단의 <span className="text-blue-400 font-bold">공유 버튼</span>을 눌러주세요.</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
             <div className="flex-shrink-0 bg-gray-700 p-2 rounded-lg">
               <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
               </svg>
            </div>
            <div>
              <p className="font-semibold text-white">2단계</p>
              <p>메뉴에서 <span className="font-bold text-white">'홈 화면에 추가'</span>를 찾아 선택해주세요.</p>
            </div>
          </div>
          
           <div className="flex items-start gap-3">
             <div className="flex-shrink-0 bg-gray-700 p-2 rounded-lg">
               <span className="font-bold text-lg text-white">추가</span>
            </div>
            <div>
              <p className="font-semibold text-white">3단계</p>
              <p>우측 상단의 <span className="font-bold text-blue-400">'추가'</span> 버튼을 누르면 설치가 완료됩니다.</p>
            </div>
          </div>
        </div>

        <button 
          onClick={onClose}
          className="w-full mt-6 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition duration-200"
        >
          확인했습니다
        </button>
      </div>
    </div>
  );
}

// Generic Content Display Component
function ContentDisplay({ collectionName, title }: { collectionName: string; title: string }) {
  const { db } = useFirebase();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    const q = query(collection(db, collectionName), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const postsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
      setPosts(postsData);
      setLoading(false);
    }, (error) => {
      console.error(`Error fetching ${collectionName}:`, error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, collectionName]);

  const toggleExpand = (postId: string) => {
    setExpandedPostId(prevId => (prevId === postId ? null : postId));
  };

  return (
    <div className="p-4 md:p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-100">{title}</h2>
      {loading ? (
        <p className="text-gray-400">콘텐츠를 불러오는 중입니다...</p>
      ) : posts.length === 0 ? (
        <p className="text-gray-400">아직 등록된 게시물이 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => {
            const isAnnouncement = collectionName === 'announcements';
            let displayTitle = post.title;
            // Clean title for announcements (remove leading "1.", "1)", etc.)
            if (isAnnouncement) {
                // Remove 1. or 1) patterns
                displayTitle = displayTitle.replace(/^[\d]+[\.\)]\s*/, '');
                
                // Hide date if it is 'null' string or falsy
                if (post.date && post.date !== 'null') {
                    // Standardize (주) to (주일)
                    const formattedDate = post.date.replace(/\(주\)/g, '(주일)');
                    displayTitle = `${displayTitle} (${formattedDate})`;
                }
            }

            return (
                <div key={post.id} className="bg-gray-800 rounded-lg shadow overflow-hidden transition-all duration-300">
                <button onClick={() => toggleExpand(post.id)} className="w-full text-left p-4 focus:outline-none focus:bg-gray-700/50">
                    <h3 className="text-xl font-semibold text-teal-400 mb-2">{displayTitle}</h3>
                    {collectionName === 'sermons' && post.bibleVerse && (
                    <p className="text-sm text-yellow-300 italic border-l-4 border-yellow-300 pl-3 mb-2">
                        {post.bibleVerse}
                    </p>
                    )}
                    {(post.author || (post.date && !isAnnouncement)) && (
                    <div className="text-sm text-gray-400 mb-2">
                        {post.author && <span>{post.author}</span>}
                        {post.author && post.date && !isAnnouncement && <span className="mx-2">|</span>}
                        {post.date && !isAnnouncement && <span>{post.date}</span>}
                    </div>
                    )}
                </button>
                {expandedPostId === post.id && (
                    <div className="p-4 pt-0">
                    <p className="text-gray-300 whitespace-pre-wrap border-t border-gray-700 pt-4">{post.content}</p>
                    </div>
                )}
                </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Password Change Component
function PasswordChange() {
    const { auth, user } = useFirebase();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setMessage('');

        if (newPassword !== confirmPassword) {
            setError('새 비밀번호가 일치하지 않습니다.');
            return;
        }
        if (!auth || !user || !user.email) {
            setError('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.');
            return;
        }

        try {
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPassword);
            setMessage('비밀번호가 성공적으로 변경되었습니다.');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setError('비밀번호 변경에 실패했습니다. 현재 비밀번호를 확인해주세요.');
            console.error(err);
        }
    };
    
    return (
        <div className="p-4 md:p-6">
            <h3 className="text-xl font-semibold mb-4">비밀번호 변경</h3>
            <form onSubmit={handleChangePassword} className="space-y-4 max-w-md bg-gray-800 p-4 rounded-lg">
                <div>
                    <label htmlFor="current-password"className="block text-sm font-medium text-gray-400">현재 비밀번호</label>
                    <input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500" />
                </div>
                <div>
                    <label htmlFor="new-password"className="block text-sm font-medium text-gray-400">새 비밀번호</label>
                    <input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500" />
                </div>
                <div>
                    <label htmlFor="confirm-password"className="block text-sm font-medium text-gray-400">새 비밀번호 확인</label>
                    <input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500" />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                {message && <p className="text-green-400 text-sm">{message}</p>}
                <button type="submit" className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-md transition duration-300">
                    비밀번호 변경
                </button>
            </form>
        </div>
    );
}

// Custom API Key Modal Component
function ApiKeyModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [key, setKey] = useState('');

  useEffect(() => {
    if (isOpen) {
      const saved = localStorage.getItem('gemini_api_key');
      if (saved) setKey(saved);
    }
  }, [isOpen]);

  const handleSave = () => {
    if (!key.trim()) {
      alert('API Key를 입력해주세요.');
      return;
    }
    localStorage.setItem('gemini_api_key', key.trim());
    alert('API Key가 저장되었습니다.');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
      <div className="bg-[#1F2937] rounded-lg max-w-md w-full shadow-2xl overflow-hidden border border-gray-700 relative">
        <button 
            onClick={onClose} 
            className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors focus:outline-none"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
        
        <div className="p-6 space-y-5">
            <h3 className="text-xl font-bold text-white mb-2">Google AI API Key 설정</h3>

          {/* Warning Box */}
          <div className="bg-[#2D1A1A] border border-[#EF4444] rounded-md p-4 text-[#EF4444] text-sm leading-relaxed">
            이 앱을 사용하려면 Google AI API Key가 필요합니다. 아래에 입력해주세요.
          </div>

          {/* Input Section */}
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">Google AI API Key 입력</label>
            <input 
              type="password" 
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="AlzaSy..." 
              className="w-full bg-[#111827] border border-gray-600 rounded-lg py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-600"
            />
            <p className="text-xs text-gray-500 mt-2">API Key는 브라우저에만 저장되며, 외부 서버로 전송되지 않습니다.</p>
          </div>

          {/* Instructions */}
          <div className="bg-[#374151] rounded-lg p-5 text-sm space-y-3">
            <h4 className="font-bold text-white">Google AI API Key 발급방법</h4>
            <ol className="list-decimal list-inside space-y-2 text-gray-300 text-xs leading-relaxed">
              <li><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline font-medium">Google AI Studio</a> 페이지로 이동하여 로그인합니다.</li>
              <li>'Get API Key' 또는 'Create API key' 버튼을 클릭합니다.</li>
              <li>생성된 API Key를 복사합니다.</li>
              <li>복사한 Key를 위 입력창에 붙여넣고 'Key 저장' 버튼을 누릅니다.</li>
            </ol>
          </div>

          {/* Save Button */}
          <button 
            onClick={handleSave}
            className="w-full bg-[#1E40AF] hover:bg-[#1D4ED8] text-white font-bold py-3.5 px-4 rounded-lg transition duration-200 text-base"
          >
            Key 저장
          </button>
        </div>
      </div>
    </div>
  );
}

// Content Management Component
function ContentManagement() {
  const { db } = useFirebase();
  const [activeAdminTab, setActiveAdminTab] = useState('sermons');
  const [title, setTitle] = useState('');
  const [bibleVerse, setBibleVerse] = useState('');
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Post | null>(null);
  const [expandedAdminPostId, setExpandedAdminPostId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string>('');
  const [bulkItems, setBulkItems] = useState<{title: string, content: string, date?: string}[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showSermonFields = activeAdminTab === 'sermons';
  const showAuthorDateFields = activeAdminTab === 'sermons' || activeAdminTab === 'columns';

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, activeAdminTab), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const postsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
      setPosts(postsData);
    });
    return () => unsubscribe();
  }, [db, activeAdminTab]);
  
  // Cleanup preview URL on unmount or change
  useEffect(() => {
    return () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const clearForm = () => {
    setTitle('');
    setContent('');
    setAuthor('');
    setDate('');
    setBibleVerse('');
    setEditingPost(null);
    setPreviewUrl(null);
    setPreviewType('');
    setBulkItems([]);
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleBulkSave = async () => {
    if (!db || bulkItems.length === 0) return;
    
    try {
        const reversedItems = [...bulkItems].reverse();

        for (const item of reversedItems) {
            const postData: { [key: string]: any } = {
                title: item.title,
                content: item.content,
                timestamp: serverTimestamp(),
            };
            if (item.date && item.date !== 'null') {
                postData.date = item.date;
            }
            
            await addDoc(collection(db, activeAdminTab), postData);
        }
        
        clearForm();
        alert(`${bulkItems.length}개의 게시물이 저장되었습니다.`);
    } catch (error) {
        console.error("Error bulk saving:", error);
        alert("일괄 저장 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteAll = async () => {
    if (!db || posts.length === 0) return;
    
    // Safety check
    if (activeAdminTab !== 'announcements') return;

    if (!window.confirm(`현재 목록에 있는 ${posts.length}개의 공지사항을 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    
    try {
        // Chunk into batches of 400 to stay safely under the 500 limit
        const chunkArray = (arr: Post[], size: number) => {
            return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
                arr.slice(i * size, i * size + size)
            );
        };

        const chunks = chunkArray(posts, 400);

        for (const chunk of chunks) {
            const batch = writeBatch(db);
            chunk.forEach(post => {
                const ref = doc(db, activeAdminTab, post.id);
                batch.delete(ref);
            });
            await batch.commit();
        }

        alert('모든 공지사항이 삭제되었습니다.');
    } catch (e) {
        console.error("Error deleting all:", e);
        alert('일괄 삭제 중 오류가 발생했습니다.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !title.trim() || !content.trim()) return;

    const postData: { [key: string]: any } = {
      title,
      content,
    };

    if (showSermonFields) {
        postData.bibleVerse = bibleVerse;
    }
    if (showAuthorDateFields) {
      postData.author = author;
      postData.date = date;
    }

    try {
      if (editingPost) {
        const postRef = doc(db, activeAdminTab, editingPost.id);
        await updateDoc(postRef, postData);
      } else {
        postData.timestamp = serverTimestamp();
        await addDoc(collection(db, activeAdminTab), postData);
      }
    } catch (error) {
      console.error("Error saving document: ", error);
    } finally {
      clearForm();
    }
  };

  const startEdit = (post: Post) => {
    setEditingPost(post);
    setTitle(post.title);
    setContent(post.content);
    setBibleVerse(post.bibleVerse || '');
    setAuthor(post.author || '');
    setDate(post.date || '');
    setBulkItems([]); // Clear bulk items if switching to edit mode
    window.scrollTo(0, 0);
  };
  
  const cancelEdit = () => {
    clearForm();
  };

  const deletePost = async (id: string) => {
    if (!db) return;

    // Close the modal immediately for better UX
    setShowDeleteConfirm(null);
    
    try {
      await deleteDoc(doc(db, activeAdminTab, id));
      // If the deleted post was the one being edited, clear the form
      if (editingPost && editingPost.id === id) {
        clearForm();
      }
    } catch (error) {
      console.error("Error deleting document: ", error);
    }
  };
  
  const toggleAdminExpand = (postId: string) => {
    setExpandedAdminPostId(prevId => (prevId === postId ? null : postId));
  };

  // AI Analysis Handler
  const handleAIAnalysis = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Support Images and PDFs
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        alert('이미지 파일(jpg, png 등) 또는 PDF 파일만 지원됩니다.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
    }
    
    // Create preview
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setPreviewType(file.type);

    setIsAnalyzing(true);
    setBulkItems([]); // Clear previous bulk items

    try {
        // 1. Convert file to Base64
        const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const result = reader.result as string;
                // Remove the "data:mime/type;base64," prefix
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = error => reject(error);
        });

        // 2. Initialize Gemini API
        // Try to get key from localStorage first, then env variable
        const savedKey = localStorage.getItem('gemini_api_key');
        // Safe access to process.env (now polyfilled, but simple check remains)
        let envKey = undefined;
        if (typeof process !== 'undefined' && process.env) {
             envKey = process.env.API_KEY;
        }
        
        const apiKey = savedKey || envKey;
        
        if (!apiKey) {
            alert("Google AI API Key가 설정되지 않았습니다. 관리자 페이지 우측 상단의 'API Key 설정' 버튼을 눌러 키를 등록해주세요.");
            setIsAnalyzing(false);
            return;
        }

        const ai = new GoogleGenAI({ apiKey });
        const model = 'gemini-2.5-flash';

        // 3. Prepare Prompt and Schema based on active tab
        let promptText = "";
        let responseSchema: any = undefined;

        if (activeAdminTab === 'announcements') {
            // BULK MODE FOR ANNOUNCEMENTS
            promptText = `
            Analyze this church bulletin image (numbered list).
            
            Rules for extraction:
            1. Extract each numbered item as a separate object.
            2. **CRITICAL**: If a numbered item contains multiple sub-events or a list of events with dates/times (e.g., item 12 has multiple rows of events), **SPLIT THEM into separate items**. 
               - Do NOT group them under one main title. 
               - Example: If #12 lists "Christmas Service" and "New Year Service" on separate lines, create TWO separate items.
            
            For each item:
            - 'title': Extract the specific event name.
            - 'content': Extract the details (time, location, etc.).
            - 'date': Extract date string if present (e.g. '12월 14일').
            
            Return an object with an 'items' array.
            `;
            
            responseSchema = {
                type: Type.OBJECT,
                properties: {
                    items: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                title: { type: Type.STRING },
                                content: { type: Type.STRING },
                                date: { type: Type.STRING }
                            }
                        }
                    }
                }
            };

        } else {
            // SINGLE ITEM MODE FOR OTHERS
            let contextInstruction = "";
            if (activeAdminTab === 'sermons') {
                contextInstruction = `
                The user is uploading a sermon script or bulletin.
                - Extract the Sermon Title into 'title'.
                - Extract the Bible Verse (e.g. John 3:16) into 'bibleVerse'.
                - Extract the Preacher's Name into 'author'.
                - Extract the full sermon text or summary into 'content'.
                - Extract the date if present into 'date'.
                `;
            } else if (activeAdminTab === 'columns') {
                contextInstruction = `
                The user is uploading a pastor's column or essay.
                - Extract the Column Title into 'title'.
                - Extract the Author Name into 'author'.
                - Extract the full column body text into 'content'.
                - Extract the date if present into 'date'.
                `;
            } else if (activeAdminTab === 'prayers') {
                contextInstruction = `
                The user is uploading a prayer text.
                - Extract the prayer title into 'title'.
                - Extract the full prayer text into 'content'.
                `;
            }
            
            promptText = `
                Analyze this church document (image/PDF) which is in Korean.
                ${contextInstruction}
                
                Return a valid JSON object with the following fields:
                - title (string): The title.
                - bibleVerse (string, optional): Only if applicable.
                - author (string, optional): Only if applicable.
                - date (string, optional): YYYY-MM-DD format if found.
                - content (string): The main extracted text/body. Ensure all relevant text is captured here.
            `;
            
            responseSchema = {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    bibleVerse: { type: Type.STRING },
                    author: { type: Type.STRING },
                    date: { type: Type.STRING },
                    content: { type: Type.STRING },
                }
            };
        }

        // 4. Generate Content
        const response = await ai.models.generateContent({
            model: model,
            contents: {
                parts: [
                    { inlineData: { mimeType: file.type, data: base64Data } },
                    { text: promptText }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        });

        // 5. Parse and Fill Form
        const resultText = response.text;
        if (resultText) {
            const data = JSON.parse(resultText);
            console.log("AI Extraction Result:", data);

            if (activeAdminTab === 'announcements' && data.items && Array.isArray(data.items) && data.items.length > 0) {
                setBulkItems(data.items);
            } else {
                if (data.title) setTitle(data.title);
                if (data.bibleVerse) setBibleVerse(data.bibleVerse);
                if (data.author) setAuthor(data.author);
                if (data.date) setDate(data.date);
                if (data.content) setContent(data.content);
            }
        }

    } catch (error) {
        console.error("AI Analysis failed:", error);
        alert("AI 분석 중 오류가 발생했습니다. 로그를 확인해주세요.\n\n" + error);
    } finally {
        setIsAnalyzing(false);
    }
  };

  const contentTabs = [
    { id: 'sermons', label: '예배말씀' },
    { id: 'columns', label: '목회자칼럼' },
    { id: 'announcements', label: '공지사항' },
    { id: 'prayers', label: '매일기도문' },
  ];

  return (
    <div>
        {/* Content Type Tabs */}
        <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
            {contentTabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => setActiveAdminTab(tab.id)}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                        activeAdminTab === tab.id
                            ? 'bg-teal-600 text-white'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
        
        {/* Editor Form */}
        <div className="bg-gray-800 p-6 rounded-lg mb-8 border border-gray-700 shadow-xl">
             <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-white">
                    {editingPost ? '게시물 수정' : '새 게시물 작성'}
                </h3>
                {editingPost && (
                    <button onClick={cancelEdit} className="text-gray-400 hover:text-white text-sm">
                        편집 취소
                    </button>
                )}
             </div>

             {/* AI Analysis Section */}
             <div className="mb-6 p-4 bg-gray-700/50 rounded-lg border border-gray-600 border-dashed">
                 <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                    <div className="flex-grow w-full">
                         <label className="block text-sm font-bold text-blue-400 mb-1 flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            AI 자동 분석 (이미지/PDF)
                         </label>
                         <p className="text-xs text-gray-400 mb-2">주보, 설교문, 공지사항 이미지를 올리면 자동으로 내용을 채워줍니다.</p>
                         <input 
                            type="file" 
                            ref={fileInputRef}
                            onChange={handleAIAnalysis}
                            accept="image/*,application/pdf"
                            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
                         />
                    </div>
                    {isAnalyzing && (
                        <div className="flex items-center text-yellow-400 text-sm font-bold animate-pulse whitespace-nowrap">
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-yellow-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            분석 중...
                        </div>
                    )}
                 </div>
                 {previewUrl && (
                    <div className="mt-4">
                         {previewType.startsWith('image/') ? (
                            <img src={previewUrl} alt="Preview" className="max-h-48 rounded border border-gray-600 object-contain bg-gray-900" />
                         ) : (
                            <div className="text-gray-300 text-sm p-3 bg-gray-800 rounded border border-gray-600 flex items-center">
                                <svg className="w-5 h-5 mr-2 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" /><path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>
                                PDF 파일이 선택되었습니다.
                            </div>
                         )}
                    </div>
                 )}
            </div>

            {/* Bulk items preview for Announcements */}
            {bulkItems.length > 0 && (
                <div className="mb-6 bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
                    <h4 className="font-bold text-blue-300 mb-2 flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        AI 분석 결과: {bulkItems.length}개의 공지사항 발견
                    </h4>
                    <div className="max-h-60 overflow-y-auto space-y-2 mb-3 pr-2 custom-scrollbar">
                        {bulkItems.map((item, idx) => (
                            <div key={idx} className="bg-gray-800 p-2 rounded text-sm border border-gray-700">
                                <div className="font-bold text-gray-200">{item.title}</div>
                                <div className="text-gray-400 text-xs mt-1">{item.content}</div>
                                {item.date && <div className="text-blue-400 text-xs mt-1">{item.date}</div>}
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button 
                            type="button" 
                            onClick={handleBulkSave}
                            className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded transition w-full"
                        >
                            모두 저장하기
                        </button>
                        <button 
                            type="button"
                            onClick={() => { setBulkItems([]); clearForm(); }}
                            className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded transition"
                        >
                            취소
                        </button>
                    </div>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-400 mb-1">제목</label>
                  <input
                    type="text"
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    className="block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                    placeholder="제목을 입력하세요"
                  />
                </div>

                {showSermonFields && (
                  <div>
                    <label htmlFor="bibleVerse" className="block text-sm font-medium text-gray-400 mb-1">성경구절</label>
                    <input
                      type="text"
                      id="bibleVerse"
                      value={bibleVerse}
                      onChange={(e) => setBibleVerse(e.target.value)}
                      className="block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                      placeholder="예: 요한복음 3:16"
                    />
                  </div>
                )}

                {showAuthorDateFields && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="author" className="block text-sm font-medium text-gray-400 mb-1">작성자/설교자</label>
                      <input
                        type="text"
                        id="author"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                        className="block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                        placeholder="이름 입력"
                      />
                    </div>
                    <div>
                      <label htmlFor="date" className="block text-sm font-medium text-gray-400 mb-1">날짜</label>
                      <input
                        type="text"
                        id="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                        placeholder="예: 2023-12-25"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="content" className="block text-sm font-medium text-gray-400 mb-1">내용</label>
                  <textarea
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    required
                    rows={10}
                    className="block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
                    placeholder="내용을 입력하세요"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 px-4 rounded-md transition duration-200 shadow-lg"
                  >
                    {editingPost ? '수정 완료' : '게시물 등록'}
                  </button>
                  {editingPost && (
                    <button
                        type="button"
                        onClick={cancelEdit}
                        className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-6 rounded-md transition duration-200"
                    >
                        취소
                    </button>
                  )}
                </div>
            </form>
        </div>

        {/* Post List */}
        <div className="space-y-4">
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-bold text-white">
                    등록된 게시물 <span className="text-sm font-normal text-gray-400">({posts.length})</span>
                </h3>
                {activeAdminTab === 'announcements' && posts.length > 0 && (
                    <button 
                        onClick={handleDeleteAll}
                        className="text-red-400 hover:text-red-300 text-xs underline"
                    >
                        전체 삭제
                    </button>
                )}
            </div>
            
            {posts.length === 0 ? (
                <div className="text-center py-10 bg-gray-800/50 rounded-lg border border-gray-700 border-dashed text-gray-500">
                    게시물이 없습니다.
                </div>
            ) : (
                posts.map((post) => (
                    <div key={post.id} className="bg-gray-800 rounded-lg p-4 border border-gray-700 shadow-sm hover:border-gray-600 transition">
                        <div className="flex justify-between items-start gap-4">
                            <div className="flex-grow min-w-0" onClick={() => toggleAdminExpand(post.id)}>
                                <h4 className="font-bold text-lg text-white truncate cursor-pointer hover:text-teal-400 transition-colors">{post.title}</h4>
                                <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-2">
                                    {post.date && <span>{post.date}</span>}
                                    {post.author && <span>· {post.author}</span>}
                                </div>
                            </div>
                            <div className="flex-shrink-0 flex space-x-2">
                                <button 
                                    onClick={() => startEdit(post)}
                                    className="p-2 bg-blue-900/50 text-blue-400 rounded hover:bg-blue-900 hover:text-blue-300 transition"
                                    title="수정"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                                <button 
                                    onClick={() => setShowDeleteConfirm(post)}
                                    className="p-2 bg-red-900/50 text-red-400 rounded hover:bg-red-900 hover:text-red-300 transition"
                                    title="삭제"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                        </div>
                        
                        {expandedAdminPostId === post.id && (
                            <div className="mt-4 pt-4 border-t border-gray-700 text-sm text-gray-300 whitespace-pre-wrap animate-fadeIn">
                                {post.content}
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4">
                <div className="bg-gray-800 rounded-lg max-w-sm w-full p-6 shadow-2xl border border-gray-700">
                    <h3 className="text-xl font-bold text-white mb-2">삭제 확인</h3>
                    <p className="text-gray-300 mb-6">
                        '<span className="font-semibold text-white">{showDeleteConfirm.title}</span>' 게시물을 정말 삭제하시겠습니까?
                        <br/><span className="text-red-400 text-sm">이 작업은 되돌릴 수 없습니다.</span>
                    </p>
                    <div className="flex justify-end gap-3">
                        <button 
                            onClick={() => setShowDeleteConfirm(null)}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition"
                        >
                            취소
                        </button>
                        <button 
                            onClick={() => deletePost(showDeleteConfirm.id)}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-bold transition"
                        >
                            삭제
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
}

function AdminLogin() {
  const { auth } = useFirebase();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    
    // Use the global admin email variable
    const adminEmail = typeof __admin_email !== 'undefined' ? __admin_email : '';
    
    if (!adminEmail || adminEmail === 'YOUR_ADMIN_EMAIL') {
         setError('관리자 이메일 설정이 올바르지 않습니다. index.html 설정을 확인해주세요.');
         return;
    }

    try {
      await signInWithEmailAndPassword(auth, adminEmail, password);
    } catch (err) {
      console.error(err);
      setError('로그인에 실패했습니다. 비밀번호를 확인해주세요.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-4">
      <form onSubmit={handleLogin} className="w-full max-w-md bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
        <h2 className="text-xl font-bold text-white mb-6 text-center">관리자 로그인</h2>
        
        {error && <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded text-red-200 text-sm">{error}</div>}
        
         <div className="mb-6">
          <label className="block text-gray-400 mb-2 text-sm font-bold">비밀번호</label>
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 transition" 
            placeholder="비밀번호"
            required 
          />
        </div>
        <button type="submit" className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded transition shadow-lg">로그인</button>
      </form>
    </div>
  );
}

function AdminPanel() {
   const { user, isAdmin, logout } = useFirebase();
   const [adminSubTab, setAdminSubTab] = useState('content');
   const [showApiKeyModal, setShowApiKeyModal] = useState(false);
   
   const adminPageTabs = [
     { id: 'content', label: '콘텐츠 관리' },
     { id: 'password', label: '비밀번호 변경' },
   ];

   if (!user || !isAdmin) {
       return <AdminLogin />;
   }

   return (
    <div className="p-4 md:p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">관리자 페이지</h2>
        <div className="flex space-x-2">
            <button 
                onClick={() => setShowApiKeyModal(true)} 
                className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-md transition duration-300 text-sm border border-gray-600"
            >
              API Key 설정
            </button>
            <button onClick={logout} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition duration-300 text-sm shadow-md">
              로그아웃
            </button>
        </div>
      </div>

      <ApiKeyModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />
      
       <div className="mb-6 border-b border-gray-700">
        <nav className="-mb-px flex space-x-4" aria-label="Tabs">
          {adminPageTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setAdminSubTab(tab.id)}
              className={`${
                adminSubTab === tab.id
                  ? 'border-teal-400 text-teal-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'
              } whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {adminSubTab === 'content' && <ContentManagement />}
      {adminSubTab === 'password' && <PasswordChange />}
    </div>
   );
}

// App Component
function App() {
  const [activeTab, setActiveTab] = useState('sermons');
  const { isAuthReady, newContent, markAsRead, isOnline } = useFirebase();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosInstruction, setShowIosInstruction] = useState(false);

  useEffect(() => {
    // Check if it's iOS
    const isDeviceIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
    setIsIos(isDeviceIos);

    // Check if already in standalone mode (installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    
    if (isStandalone) {
        setShowInstallBanner(false);
    } else {
        if (isDeviceIos) {
            // For iOS, show banner if not standalone
            setShowInstallBanner(true);
        }
    }

    // Android/Desktop: Listen for install prompt
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIos) {
        setShowIosInstruction(true);
    } else if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setDeferredPrompt(null);
            setShowInstallBanner(false);
        }
    }
  };

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    if (['sermons', 'columns', 'announcements', 'prayers'].includes(tabId)) {
        markAsRead(tabId);
    }
  };

  const tabColorClasses: { [key: string]: string } = {
    sermons: 'bg-sky-600 hover:bg-sky-500',
    columns: 'bg-emerald-600 hover:bg-emerald-500',
    announcements: 'bg-orange-600 hover:bg-orange-500',
    prayers: 'bg-indigo-600 hover:bg-indigo-500',
    admin: 'bg-rose-600 hover:bg-rose-500',
  };

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-white text-xl">앱을 불러오는 중입니다...</div>
      </div>
    );
  }
  
  const tabs = [
    { id: 'sermons', label: '예배말씀' },
    { id: 'columns', label: '목회자칼럼' },
    { id: 'announcements', label: '공지사항' },
    { id: 'prayers', label: '매일기도문' },
    { id: 'admin', label: '관리자' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-900 pb-20"> {/* pb-20 for bottom banner space */}
      <header className="bg-gray-800 p-4 text-center shadow-lg">
        <h1 className="text-2xl font-bold text-white">
          성은감리교회
          <span className="block text-xs text-gray-400 font-normal mt-1">(영혼을 구원하여 제자삼는 가정교회)</span>
        </h1>
      </header>

      <nav className="bg-gray-800 sticky top-0 z-10 shadow">
        <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-center h-16">
            <div className="flex items-center justify-center sm:items-stretch sm:justify-start">
              <div className="flex space-x-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => handleTabClick(tab.id)}
                    className={`${
                      tabColorClasses[tab.id] || 'bg-gray-700 hover:bg-gray-600'
                    } ${
                      activeTab === tab.id
                        ? 'text-white ring-2 ring-offset-2 ring-offset-gray-800 ring-white'
                        : 'text-gray-200 opacity-80 hover:opacity-100'
                    } relative px-3 py-4 rounded-md text-sm font-medium transition-all duration-200 flex items-center justify-center`}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                  >
                    <span>{tab.label}</span>
                    {newContent[tab.id] && ['sermons', 'columns', 'announcements', 'prayers'].includes(tab.id) && (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-rose-500 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center ring-1 ring-white/50">N</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'sermons' && <ContentDisplay collectionName="sermons" title="예배말씀" />}
        {activeTab === 'columns' && <ContentDisplay collectionName="columns" title="목회자칼럼" />}
        {activeTab === 'announcements' && <ContentDisplay collectionName="announcements" title="공지사항" />}
        {activeTab === 'prayers' && <ContentDisplay collectionName="prayers" title="매일기도문" />}
        {activeTab === 'admin' && <AdminPanel />}
      </main>

      {!isOnline && (
        <div className="fixed bottom-24 right-4 bg-red-600 text-white text-sm font-bold py-2 px-4 rounded-lg shadow-lg z-50 flex items-center space-x-2 animate-pulse" role="alert" aria-live="assertive">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m12.728 0L5.636 18.364m0-12.728L18.364 18.364" /></svg>
            <span>연결이 끊겼습니다. 오프라인 모드입니다.</span>
        </div>
      )}

      {/* PWA Install Banner */}
      {showInstallBanner && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4 shadow-2xl z-40 flex items-center justify-between transition-transform duration-300 transform translate-y-0">
            <div className="flex items-center">
                <div className="bg-teal-600 p-2 rounded-lg mr-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                </div>
                <div>
                    <p className="text-white font-bold text-sm">앱으로 더 편하게 이용하세요</p>
                    <p className="text-gray-400 text-xs">홈 화면에 추가하여 빠르게 접속</p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setShowInstallBanner(false)}
                    className="text-gray-400 hover:text-white p-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
                <button 
                    onClick={handleInstallClick}
                    className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors whitespace-nowrap shadow-lg"
                >
                    앱 설치
                </button>
            </div>
        </div>
      )}

      {/* iOS Instructions Modal */}
      <IosInstallModal isOpen={showIosInstruction} onClose={() => setShowIosInstruction(false)} />

    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <FirebaseProvider>
          <App />
        </FirebaseProvider>
      </React.StrictMode>
    );
} else {
    console.error("Failed to find the root element");
}