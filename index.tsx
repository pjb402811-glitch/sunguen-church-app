


import React, { useState, useEffect, createContext, useContext } from 'react';
import ReactDOM from 'react-dom/client';
// FIX: Split Firebase value and type imports to resolve module resolution errors and prevent downstream type inference problems.
import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, type Auth } from 'firebase/auth';
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
  userId: string | null;
  isAdmin: boolean;
  isAuthReady: boolean;
  appId: string;
}

// Firebase Context 생성
const FirebaseContext = createContext<FirebaseContextType | null>(null);

// Firebase Provider 컴포넌트
function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [app, setApp] = useState<FirebaseApp | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
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

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
          // Admin status is determined by matching the UID against the configured admin UID.
          const isAdminUser = !!(adminId && user.uid === adminId && adminId !== 'PASTE_YOUR_ADMIN_UID_HERE');
          setIsAdmin(isAdminUser);
        } else {
          setUserId(null);
          setIsAdmin(false);
          try {
            if (typeof __initial_auth_token !== 'undefined') {
              await signInWithCustomToken(firebaseAuth, __initial_auth_token);
            } else {
              await signInAnonymously(firebaseAuth);
            }
          } catch (error) {
            console.error("Firebase authentication error:", error);
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

  const contextValue: FirebaseContextType = {
    app, db, auth, userId, isAdmin, isAuthReady, appId
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
  const { db, appId, isAdmin, isAuthReady, userId } = useFirebase();
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
      <div className="flex flex-col items-center justify-center min-h-[400px] bg-gray-800 text-gray-200 p-8 rounded-lg shadow-md space-y-4">
        <h2 className="text-2xl font-bold">관리자 권한이 필요합니다.</h2>
        <p className="text-lg text-gray-300 text-center">이 페이지는 지정된 관리자만 접근할 수 있습니다.</p>
        <p className="text-md text-gray-500">현재 사용자 ID: <span className="font-mono bg-gray-700 p-1 rounded text-gray-200">{userId || '로그인되지 않음'}</span></p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-800 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4 text-white">관리자 페이지</h2>
      <p className="text-sm text-gray-400 mb-4">관리자 User ID: <span className="font-mono bg-gray-700 p-1 rounded text-gray-200">{userId}</span></p>

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
            <div key={item.id} className="border border-gray-700 p-4 rounded-md bg-gray-700 flex justify-between items-center">
              <div>
                <h4 className="text-lg font-medium text-white">{item.title}</h4>
                {currentAdminTab === 'sermons' && <div className="text-sm text-gray-400 mt-1 space-y-1">
                  {(item.author || item.sermonDate) && <p className="space-x-2">{item.author && <span>{item.author}</span>}{item.author && item.sermonDate && <span>|</span>}{item.sermonDate && <span>{item.sermonDate}</span>}</p>}
                  {item.bibleVerse && <p>성경구절: {item.bibleVerse}</p>}
                </div>}
                {currentAdminTab === 'columns' && <div className="text-sm text-gray-400 mt-1">
                  {(item.author || item.columnDate) && <p className="space-x-2">{item.author && <span>{item.author}</span>}{item.author && item.columnDate && <span>|</span>}{item.columnDate && <span>{item.columnDate}</span>}</p>}
                </div>}
                <p className="text-gray-300 text-sm mt-1 line-clamp-2">{item.content}</p>
                {item.timestamp && <p className="text-xs text-gray-500 mt-1">최종 업데이트: {new Date(item.timestamp.toDate()).toLocaleString()}</p>}
              </div>
              <div className="flex space-x-2 ml-4">
                <button onClick={() => handleEdit(item)} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2 px-3 rounded-md transition-colors duration-200">수정</button>
                <button onClick={() => setConfirmDeleteId(item.id)} className="bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-2 px-3 rounded-md transition-colors duration-200">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4">
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4 text-white">삭제 확인</h3>
            <p className="mb-6 text-gray-300">정말로 이 콘텐츠를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</p>
            <div className="flex justify-end space-x-4">
              <button onClick={() => setConfirmDeleteId(null)} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200">취소</button>
              <button onClick={() => handleDelete(confirmDeleteId)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// 메인 앱 컴포넌트
function App() {
  const [currentTab, setCurrentTab] = useState('sermons');
  const { userId, isAdmin, isAuthReady } = useFirebase();

  const allTabs = [
    { id: 'sermons', name: '예배말씀' },
    { id: 'columns', name: '목회자칼럼' },
    { id: 'announcements', name: '공지사항' },
    { id: 'admin', name: '관리자' },
  ];

  const visibleTabs = isAdmin ? allTabs : allTabs.filter(tab => tab.id !== 'admin');

  useEffect(() => {
    // If the admin logs out while on the admin tab, switch to the home tab.
    if (!isAdmin && currentTab === 'admin') {
      setCurrentTab('sermons');
    }
  }, [isAdmin, currentTab]);


  return (
    <div className="min-h-screen bg-gray-900 font-sans antialiased text-white">
      <div className="container mx-auto p-4 max-w-4xl">
        <header>
          <h1 className="text-4xl font-extrabold text-center mb-8 text-indigo-400">
            <span role="img" aria-label="church-icon" className="mr-2">⛪</span>
            성은감리교회
          </h1>
        </header>

        {isAuthReady && userId && (
          <div className="text-right text-sm text-gray-400 mb-4">
            현재 사용자 ID: <span className="font-mono bg-gray-700 p-1 rounded text-gray-200">{userId}</span>
            {isAdmin && <span className="ml-2 px-2 py-1 bg-indigo-700 text-indigo-100 rounded-full text-xs font-semibold">관리자</span>}
          </div>
        )}

        <nav className="mb-8 bg-gray-800 p-3 rounded-lg shadow-md">
          <ul className="flex justify-around space-x-2" role="tablist">
            {visibleTabs.map(tab => (
              <li key={tab.id} className="flex-1" role="presentation">
                <button id={`tab-${tab.id}`} onClick={() => setCurrentTab(tab.id)} className={`w-full py-3 px-4 rounded-md text-lg font-medium transition-all duration-300 ${currentTab === tab.id ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-700 text-gray-200 hover:bg-gray-600 hover:text-indigo-400'}`} role="tab" aria-selected={currentTab === tab.id} aria-controls={`tabpanel-${tab.id}`}>
                  {tab.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main>
          <div id="tabpanel-sermons" role="tabpanel" aria-labelledby="tab-sermons" hidden={currentTab !== 'sermons'}>
            {currentTab === 'sermons' && <ContentList contentType="sermons" title="예배말씀" />}
          </div>
          <div id="tabpanel-columns" role="tabpanel" aria-labelledby="tab-columns" hidden={currentTab !== 'columns'}>
            {currentTab === 'columns' && <ContentList contentType="columns" title="목회자칼럼" />}
          </div>
          <div id="tabpanel-announcements" role="tabpanel" aria-labelledby="tab-announcements" hidden={currentTab !== 'announcements'}>
            {currentTab === 'announcements' && <ContentList contentType="announcements" title="공지사항" />}
          </div>
          <div id="tabpanel-admin" role="tabpanel" aria-labelledby="tab-admin" hidden={currentTab !== 'admin'}>
            {currentTab === 'admin' && <AdminPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}

function ChurchApp() {
  return (
    <React.StrictMode>
      <FirebaseProvider>
        <App />
      </FirebaseProvider>
    </React.StrictMode>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(<ChurchApp />);
}