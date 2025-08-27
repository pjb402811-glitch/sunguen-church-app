
import React, { useState, useEffect, createContext, useContext } from 'react';
import ReactDOM from 'react-dom/client';
// FIX: Combined 'firebase/app' imports into a single statement to resolve module resolution errors.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, onSnapshot, type Firestore } from 'firebase/firestore';

// In a production environment, these would be managed via build-time environment variables.
// For this context, we declare them as potentially available globals set in index.html.
declare const __app_id: string;
declare const __firebase_config: string;
declare const __initial_auth_token: string;
declare const __admin_user_id: string;

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
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

// Firebase Context 생성
const FirebaseContext = createContext<FirebaseContextType | null>(null);

// Firebase Provider 컴포넌트
function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [app, setApp] = useState<FirebaseApp | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

  useEffect(() => {
    try {
      const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
      const adminId = typeof __admin_user_id !== 'undefined' ? __admin_user_id : null;

      if (!Object.keys(firebaseConfig).length || firebaseConfig.apiKey === "YOUR_API_KEY") {
        console.error("Firebase config is missing or using placeholder values. Please ensure __firebase_config is set with your actual project credentials in index.html.");
        setIsAuthReady(true);
        return;
      }
      
      const firebaseApp = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(firebaseApp);
      const firebaseAuth = getAuth(firebaseApp);

      setApp(firebaseApp);
      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          setUserId(currentUser.uid);
          setIsAnonymous(currentUser.isAnonymous);
          const isAdminUser = !!(adminId && currentUser.uid === adminId && adminId !== 'PASTE_YOUR_ADMIN_UID_HERE');
          setIsAdmin(isAdminUser);
        } else {
          // User logged out, so sign them in anonymously for read-only access.
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

      return () => unsubscribe();
    } catch (e) {
        console.error("Error initializing Firebase:", e);
        setIsAuthReady(true);
    }
  }, []);
  
  const login = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google login error:", error);
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
    app, db, auth, user, userId, isAdmin, isAnonymous, isAuthReady, appId, login, logout
  };

  return (
    <FirebaseContext.Provider value={contextValue}>
      {children}
    </FirebaseContext.Provider>
  );
}

// Firebase Hooks
function useFirebase() {
  const context = useContext(FirebaseContext);
  if (!context) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
}

// 공통 콘텐츠 관리 함수
const getContentCollectionPath = (appId: string, contentType: string) => `/artifacts/${appId}/public/data/${contentType}`;

// 콘텐츠 리스트 컴포넌트
function ContentList({ contentType, title }: { contentType: string, title: string }) {
  const { db, appId, isAuthReady } = useFirebase();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !isAuthReady || !appId) {
        setLoading(false);
        return;
    };

    const collectionPath = getContentCollectionPath(appId, contentType);
    const q = query(collection(db, collectionPath));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      fetchedItems.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
      setItems(fetchedItems);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching content:", err);
      setError("콘텐츠를 불러오는 데 실패했습니다.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, appId, contentType, isAuthReady]);

  if (loading) return <div className="text-center p-4 text-white">로딩 중...</div>;
  if (error) return <div className="text-center p-4 text-red-400">{error}</div>;

  return (
    <div className="p-4 bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4 text-white">{title}</h2>
      {items.length === 0 ? (
        <p className="text-gray-400">등록된 {title}이(가) 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <div key={item.id} className="border border-gray-700 p-4 rounded-md bg-gray-700">
              <h3 className="text-xl font-semibold text-white">{item.title}</h3>
              {contentType === 'sermons' && (
                <div className="text-sm text-gray-400 mt-1 space-y-1">
                  {(item.author || item.sermonDate) && <p className="space-x-2">{item.author && <span>{item.author}</span>}{item.author && item.sermonDate && <span>|</span>}{item.sermonDate && <span>{item.sermonDate}</span>}</p>}
                  {item.bibleVerse && <p>성경구절: {item.bibleVerse}</p>}
                </div>
              )}
              {contentType === 'columns' && (
                <div className="text-sm text-gray-400 mt-1">
                   {(item.author || item.columnDate) && <p className="space-x-2">{item.author && <span>{item.author}</span>}{item.author && item.columnDate && <span>|</span>}{item.columnDate && <span>{item.columnDate}</span>}</p>}
                </div>
              )}
              <p className="text-gray-300 mt-2 whitespace-pre-wrap">{item.content}</p>
              {item.timestamp && (
                <p className="text-sm text-gray-500 mt-2">
                  최종 업데이트: {new Date(item.timestamp.toDate()).toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 관리자 패널 컴포넌트
function AdminPanel() {
  const { db, appId, isAdmin, isAuthReady, userId, login, logout, user } = useFirebase();
  const [currentAdminTab, setCurrentAdminTab] = useState('sermons');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formAuthor, setFormAuthor] = useState('');
  const [formSermonDate, setFormSermonDate] = useState(new Date().toISOString().split('T')[0]);
  const [formBibleVerse, setFormBibleVerse] = useState('');
  const [formColumnAuthor, setFormColumnAuthor] = useState('');
  const [formColumnDate, setFormColumnDate] = useState(new Date().toISOString().split('T')[0]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adminTabs = [
    { id: 'sermons', name: '예배말씀 관리' },
    { id: 'columns', name: '목회자칼럼 관리' },
    { id: 'announcements', name: '공지사항 관리' },
  ];

  useEffect(() => {
    if (!db || !isAuthReady || !isAdmin || !appId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const collectionPath = getContentCollectionPath(appId, currentAdminTab);
    const q = query(collection(db, collectionPath));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      fetchedItems.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
      setItems(fetchedItems);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching admin content:", err);
      setError("관리할 콘텐츠를 불러오는 데 실패했습니다.");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, appId, currentAdminTab, isAdmin, isAuthReady]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !isAdmin || !appId || !formTitle || !formContent) {
      setMessage('제목과 내용을 모두 입력해주세요.');
      return;
    }

    let dataToSave: any = {
      title: formTitle,
      content: formContent,
      timestamp: serverTimestamp(),
    };

    if (currentAdminTab === 'sermons') {
      dataToSave = { ...dataToSave, author: formAuthor, sermonDate: formSermonDate, bibleVerse: formBibleVerse };
    } else if (currentAdminTab === 'columns') {
      dataToSave = { ...dataToSave, author: formColumnAuthor, columnDate: formColumnDate };
    }

    try {
      const collectionRef = collection(db, getContentCollectionPath(appId, currentAdminTab));
      if (editingItemId) {
        await updateDoc(doc(collectionRef, editingItemId), dataToSave);
        setMessage('콘텐츠가 성공적으로 수정되었습니다.');
      } else {
        await addDoc(collectionRef, dataToSave);
        setMessage('콘텐츠가 성공적으로 등록되었습니다.');
      }
      setFormTitle('');
      setFormContent('');
      setFormAuthor('');
      setFormSermonDate(new Date().toISOString().split('T')[0]);
      setFormBibleVerse('');
      setFormColumnAuthor('');
      setFormColumnDate(new Date().toISOString().split('T')[0]);
      setEditingItemId(null);
    } catch (err: any) {
      console.error("Error adding/updating document:", err);
      setMessage(`오류 발생: ${err.message}`);
    }
  };
  
  const handleEdit = (item: any) => {
    setFormTitle(item.title);
    setFormContent(item.content);
    setEditingItemId(item.id);
    setMessage('');
    setFormAuthor('');
    setFormSermonDate(new Date().toISOString().split('T')[0]);
    setFormBibleVerse('');
    setFormColumnAuthor('');
    setFormColumnDate(new Date().toISOString().split('T')[0]);

    if (currentAdminTab === 'sermons') {
      setFormAuthor(item.author || '');
      setFormSermonDate(item.sermonDate || new Date().toISOString().split('T')[0]);
      setFormBibleVerse(item.bibleVerse || '');
    } else if (currentAdminTab === 'columns') {
      setFormColumnAuthor(item.author || '');
      setFormColumnDate(item.columnDate || new Date().toISOString().split('T')[0]);
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!db || !isAdmin || !appId) return;
    try {
      const collectionPath = getContentCollectionPath(appId, currentAdminTab);
      await deleteDoc(doc(db, collectionPath, itemId));
      setMessage('콘텐츠가 성공적으로 삭제되었습니다.');
      setConfirmDeleteId(null);
    } catch (err: any) {
      console.error("Error deleting document:", err);
      setMessage(`오류 발생: ${err.message}`);
    }
  };

  if (!isAuthReady) {
    return <div className="text-center p-4 text-white">인증 상태 확인 중...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] bg-gray-800 text-gray-200 p-8 rounded-lg shadow-md space-y-6">
        <h2 className="text-2xl font-bold">관리자 권한이 필요합니다</h2>
        <p className="text-lg text-gray-300 text-center">콘텐츠를 관리하려면 Google 계정으로 로그인해주세요.</p>
        <button onClick={login} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-md transition-colors duration-200 text-lg">
          Google 계정으로 관리자 로그인
        </button>
        {userId && <p className="text-md text-gray-500 mt-4 pt-4 border-t border-gray-700 w-full text-center">현재 사용자 ID (설정 확인용): <span className="font-mono bg-gray-700 p-1 rounded text-gray-200">{userId}</span></p>}
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-800 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-white">관리자 페이지</h2>
        <button onClick={logout} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200 text-sm">로그아웃</button>
      </div>
      <p className="text-sm text-gray-400 mb-4">관리자 User ID: <span className="font-mono bg-gray-700 p-1 rounded text-gray-200">{userId}</span> ({user?.displayName})</p>

      <div className="mb-6 flex space-x-2 border-b border-gray-700 pb-2">
        {adminTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setCurrentAdminTab(tab.id);
              setFormTitle(''); setFormContent(''); setEditingItemId(null); setMessage(''); setError(null); setLoading(true);
              setFormAuthor(''); setFormSermonDate(new Date().toISOString().split('T')[0]); setFormBibleVerse('');
              setFormColumnAuthor(''); setFormColumnDate(new Date().toISOString().split('T')[0]);
            }}
            className={`px-4 py-2 rounded-t-lg transition-colors duration-200 ${currentAdminTab === tab.id ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
          >{tab.name}</button>
        ))}
      </div>

      {message && <div className={`p-3 mb-4 rounded-md ${message.startsWith('오류') ? 'bg-red-800 text-red-100' : 'bg-green-800 text-green-100'}`}>{message}</div>}

      <form onSubmit={handleSubmit} className="bg-gray-700 p-6 rounded-lg shadow-inner mb-6">
        <h3 className="text-xl font-semibold mb-4 text-white">{editingItemId ? '콘텐츠 수정' : '새 콘텐츠 등록'}</h3>
        <div className="mb-4">
          <label htmlFor="title" className="block text-gray-200 text-sm font-bold mb-2">제목</label>
          <input type="text" id="title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="shadow appearance-none border border-gray-600 rounded-md w-full py-2 px-3 bg-gray-800 text-white leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="제목을 입력하세요" />
        </div>
        {currentAdminTab === 'sermons' && (
          <>
            <div className="mb-4">
              <label htmlFor="author" className="block text-gray-200 text-sm font-bold mb-2">작성자</label>
              <input type="text" id="author" value={formAuthor} onChange={(e) => setFormAuthor(e.target.value)} className="shadow appearance-none border border-gray-600 rounded-md w-full py-2 px-3 bg-gray-800 text-white leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="작성자를 입력하세요" />
            </div>
            <div className="mb-4">
              <label htmlFor="sermonDate" className="block text-gray-200 text-sm font-bold mb-2">날짜</label>
              <input type="date" id="sermonDate" value={formSermonDate} onChange={(e) => setFormSermonDate(e.target.value)} className="shadow appearance-none border border-gray-600 rounded-md w-full py-2 px-3 bg-gray-800 text-white leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="mb-4">
              <label htmlFor="bibleVerse" className="block text-gray-200 text-sm font-bold mb-2">성경구절</label>
              <input type="text" id="bibleVerse" value={formBibleVerse} onChange={(e) => setFormBibleVerse(e.target.value)} className="shadow appearance-none border border-gray-600 rounded-md w-full py-2 px-3 bg-gray-800 text-white leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="예: 요한복음 3:16" />
            </div>
          </>
        )}
        {currentAdminTab === 'columns' && (
          <>
            <div className="mb-4">
              <label htmlFor="columnAuthor" className="block text-gray-200 text-sm font-bold mb-2">작성자</label>
              <input type="text" id="columnAuthor" value={formColumnAuthor} onChange={(e) => setFormColumnAuthor(e.target.value)} className="shadow appearance-none border border-gray-600 rounded-md w-full py-2 px-3 bg-gray-800 text-white leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="작성자를 입력하세요" />
            </div>
            <div className="mb-4">
              <label htmlFor="columnDate" className="block text-gray-200 text-sm font-bold mb-2">날짜</label>
              <input type="date" id="columnDate" value={formColumnDate} onChange={(e) => setFormColumnDate(e.target.value)} className="shadow appearance-none border border-gray-600 rounded-md w-full py-2 px-3 bg-gray-800 text-white leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </>
        )}
        <div className="mb-4">
          <label htmlFor="content" className="block text-gray-200 text-sm font-bold mb-2">내용</label>
          <textarea id="content" value={formContent} onChange={(e) => setFormContent(e.target.value)} rows={6} className="shadow appearance-none border border-gray-600 rounded-md w-full py-2 px-3 bg-gray-800 text-white leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="내용을 입력하세요"></textarea>
        </div>
        <div className="flex space-x-4">
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-75 transition-colors duration-200">{editingItemId ? '수정하기' : '등록하기'}</button>
          {editingItemId && <button type="button" onClick={() => { setFormTitle(''); setFormContent(''); setFormAuthor(''); setFormSermonDate(new Date().toISOString().split('T')[0]); setFormBibleVerse(''); setFormColumnAuthor(''); setFormColumnDate(new Date().toISOString().split('T')[0]); setEditingItemId(null); setMessage(''); }} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-opacity-75 transition-colors duration-200">취소</button>}
        </div>
      </form>

      <h3 className="text-xl font-semibold mb-4 text-white">기존 콘텐츠</h3>
      {loading ? <div className="text-center p-4 text-white">로딩 중...</div> : error ? <div className="text-center p-4 text-red-400">{error}</div> : items.length === 0 ? <p className="text-gray-400">등록된 콘텐츠가 없습니다.</p> : (
        <div className="space-y-4">
          {items.map(item => (
            <div key={item.id} className="border border-gray-700 p-4 rounded-md bg-gray-700 flex justify-between items-start">
              <div className="flex-1 pr-4">
                <h4 className="text-lg font-medium text-white">{item.title}</h4>
                 <p className="text-sm text-gray-500 mt-2">
                   {item.timestamp ? `최종 업데이트: ${new Date(item.timestamp.toDate()).toLocaleString()}` : ''}
                 </p>
              </div>
              <div className="flex space-x-2 flex-shrink-0">
                 <button onClick={() => handleEdit(item)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded-md text-sm transition-colors duration-200">수정</button>
                 <button onClick={() => setConfirmDeleteId(item.id)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-md text-sm transition-colors duration-200">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}
       {confirmDeleteId && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-8 rounded-lg shadow-xl text-center">
            <h3 className="text-xl font-bold mb-4 text-white">정말로 삭제하시겠습니까?</h3>
            <p className="text-gray-300 mb-6">이 작업은 되돌릴 수 없습니다.</p>
            <div className="flex justify-center space-x-4">
              <button onClick={() => handleDelete(confirmDeleteId)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-md transition-colors duration-200">삭제 확인</button>
              <button onClick={() => setConfirmDeleteId(null)} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-md transition-colors duration-200">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  const { user, isAnonymous, isAdmin } = useFirebase();

  return (
    <header className="bg-gray-800 shadow-md p-4">
      <div className="container mx-auto flex justify-between items-center">
        <h1 className="text-2xl font-bold text-white">성은감리교회</h1>
      </div>
    </header>
  );
}

function Footer() {
  const { userId } = useFirebase();
  return (
      <footer className="bg-gray-800 text-center p-4 mt-8">
          <p className="text-gray-500 text-sm">© {new Date().getFullYear()} 성은감리교회. All Rights Reserved.</p>
          {userId && <p className="text-xs text-gray-600 mt-2">Session ID: <span className="font-mono">{userId}</span></p>}
      </footer>
  );
}

function ChurchApp() {
  const [activeTab, setActiveTab] = useState('sermons');
  const { isAdmin, isAuthReady } = useFirebase();

  const tabs = [
    { id: 'sermons', name: '예배말씀' },
    { id: 'columns', name: '목회자칼럼' },
    { id: 'announcements', name: '공지사항' },
    ...(isAdmin ? [{ id: 'admin', name: '관리자' }] : []),
  ];
  
  return (
    <div className="min-h-screen bg-gray-900 text-gray-200">
      <Header />
      <main className="container mx-auto p-4">
        <div className="mb-4 border-b border-gray-700">
          <nav className="flex space-x-4" aria-label="Tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`${
                  activeTab === tab.id
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'
                } whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
              >
                {tab.name}
              </button>
            ))}
          </nav>
        </div>
        
        {!isAuthReady ? (
          <div className="text-center p-8 text-white">앱을 불러오는 중입니다...</div>
        ) : (
          <div>
            {activeTab === 'sermons' && <ContentList contentType="sermons" title="예배말씀" />}
            {activeTab === 'columns' && <ContentList contentType="columns" title="목회자칼럼" />}
            {activeTab === 'announcements' && <ContentList contentType="announcements" title="공지사항" />}
            {activeTab === 'admin' && isAdmin && <AdminPanel />}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
// FIX: The error regarding the 'children' prop on FirebaseProvider is likely a cascading type error
// from the unresolved Firebase imports. Fixing the imports above should resolve this issue without
// needing to change the code here, which is correctly passing <ChurchApp /> as a child.
root.render(
  <React.StrictMode>
    <FirebaseProvider>
      <ChurchApp />
    </FirebaseProvider>
  </React.StrictMode>
);
