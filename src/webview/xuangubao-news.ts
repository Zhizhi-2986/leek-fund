import { ViewColumn, WebviewPanel, ExtensionContext } from 'vscode';
import ReusedWebviewPanel from './ReusedWebviewPanel';
import { getTemplateFileContent } from '../shared/utils';
import axios from 'axios';

type XuanGuBaoMessage = {
  title: string;
  summary: string;
  impact: number;
  bkj_infos?: any[];
  created_at: number;
  id: number;
};

type XuanGuBaoNewsData = {
  messages: XuanGuBaoMessage[];
  next_cursor: string;
  lastUpdate: number;
  allDayMessages: XuanGuBaoMessage[];
};

const NEWS_FLASH_URL = 'https://baoer-api.xuangubao.com.cn/api/v6/message/newsflash';

export class XuanGuBaoNewsView {
  private static instance: XuanGuBaoNewsView;
  private panel: WebviewPanel | null = null;

  private constructor() {}

  public static getInstance(): XuanGuBaoNewsView {
    if (!XuanGuBaoNewsView.instance) {
      XuanGuBaoNewsView.instance = new XuanGuBaoNewsView();
    }
    return XuanGuBaoNewsView.instance;
  }

  public show() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = ReusedWebviewPanel.create(
      'xuangubaoNewsWebview',
      '选股宝快讯',
      ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'refreshNews':
          this.refreshNews();
          return;
        case 'getNewsData':
          this.sendNewsData();
          return;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.refreshNews();
  }

  private refreshNews() {
    if (!this.panel) return;

    const initialRoute = '/data-center/xuangubao-news';
    const html = getTemplateFileContent(['leek-center', 'build', 'index.html'], this.panel.webview);
    this.panel.webview.html = html.replace(
      '<head>',
      `<head><script>window.initialRoute = '${initialRoute}';</script>`
    );

    setTimeout(() => {
      this.sendNewsData();
    }, 500);
  }

  private async sendNewsData() {
    if (!this.panel) return;

    try {
      const newsData = await this.fetchNewsData();
      this.panel.webview.postMessage({
        command: 'newsData',
        data: newsData
      });
    } catch (error) {
      console.error('获取选股宝快讯数据失败:', error);
      this.panel.webview.postMessage({
        command: 'newsData',
        data: {
          messages: [],
          next_cursor: '',
          lastUpdate: Date.now(),
          allDayMessages: []
        }
      });
    }
  }

  private async fetchNewsData(): Promise<XuanGuBaoNewsData> {
    const subjectIds = [9, 10, 723, 35, 469];

    const latestRes = await axios.get(NEWS_FLASH_URL, {
      params: {
        limit: 20,
        subj_ids: subjectIds.join(','),
        platform: 'pcweb',
      },
    });

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayStartTimestamp = Math.floor(todayStart.getTime() / 1000);

    const allDayRes = await axios.get(NEWS_FLASH_URL, {
      params: {
        limit: 100,
        subj_ids: subjectIds.join(','),
        start_time: todayStartTimestamp,
        platform: 'pcweb',
      },
    });

    if (latestRes.data.code === 20000 && allDayRes.data.code === 20000) {
      const { messages, next_cursor } = latestRes.data.data;
      const allDayMessages = allDayRes.data.data.messages || [];

      const uniqueAllDayMessages: XuanGuBaoMessage[] = [];
      const seenIds = new Set<number>();

      allDayMessages.forEach((msg: XuanGuBaoMessage) => {
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          uniqueAllDayMessages.push(msg);
        }
      });

      return {
        messages: messages,
        next_cursor: next_cursor,
        lastUpdate: Date.now(),
        allDayMessages: uniqueAllDayMessages
      };
    }

    return {
      messages: [],
      next_cursor: '',
      lastUpdate: Date.now(),
      allDayMessages: []
    };
  }
}
