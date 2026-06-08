import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, Button, List } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { postMessage } from '@/utils/common';
import './style.less';

const { TabPane } = Tabs;

interface NewsItem {
  title: string;
  summary: string;
  created_at: number;
  [key: string]: any;
}

interface NewsData {
  messages: NewsItem[];
  allDayMessages: NewsItem[];
}

const XuangubaoNews: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [newsData, setNewsData] = useState<NewsData>({ messages: [], allDayMessages: [] });
  const [activeTab, setActiveTab] = useState('latest');

  const fetchNews = useCallback(() => {
    setLoading(true);
    postMessage('getNewsData');
    setTimeout(() => setLoading(false), 5000);
  }, []);

  useEffect(() => {
    fetchNews();

    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.command === 'newsData') {
        setNewsData(msg.data);
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [fetchNews]);

  const handleRefresh = () => {
    fetchNews();
    postMessage('refreshNews');
  };

  const renderNewsList = (list: NewsItem[]) => (
    <List
      className="news-list"
      loading={loading && list.length === 0}
      dataSource={list}
      renderItem={item => (
        <div className="news-item">
          <div className="news-title">{item.title || '无标题'}</div>
          <div className="news-summary">{item.summary || '无内容'}</div>
          <div className="news-meta">
            <span>{new Date(item.created_at * 1000).toLocaleString()}</span>
          </div>
        </div>
      )}
      locale={{ emptyText: '暂无快讯数据' }}
    />
  );

  return (
    <div className="xuangubao-news-page">
      <div className="header">
        <h1>选股宝快讯</h1>
        <div>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >
            刷新数据
          </Button>
        </div>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="最新快讯" key="latest">
          {renderNewsList(newsData.messages)}
        </TabPane>
        <TabPane tab="当日全部" key="allDay">
          {renderNewsList(newsData.allDayMessages)}
        </TabPane>
      </Tabs>
    </div>
  );
};

export default XuangubaoNews;
