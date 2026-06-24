const undef = void 0;
const vscode = acquireVsCodeApi();
const deviceId =
  Math.random().toString(16).substr(2) + Math.random().toString(32).substr(2);

function checkInputValue(v) {
  return /^[0-9]+(.[0-9]{1,3})?%?$/.test(v);
}

function vscode_alert(msg) {
  vscode.postMessage({
    command: 'alert',
    message: msg,
  });
}

const Talker = {
  options: {},
  _threadId: 0,
  _createIssueLockMap: {},
  _currentTask: null,
  _nextTask: null,
  _initGitalk() {
    if (!this.ready || !this.options.id) return;
    $('#gitalk-container').html('');
    let _gitalk = new Gitalk({
      clientID: '',
      clientSecret: '',
      // repo: 'gittalk-demo', // The repository of store comments,
      repo: 'leek-discussions', // The repository of store comments,
      // owner: 'zqjimlove',
      owner: 'LeekHub',
      admin: ['zqjimlove'],
      id: this.options.id || 'SH000001', // Ensure uniqueness and length less than 50
      distractionFreeMode: false, // Facebook-like distraction free mode
      accessToken: this.accessToken,
      title: this.options.title,
      body: this.options.body,
      checkAdmin: false,
      createIssueManually: false,
      labels: this.options.labels || ['discussions', 'stock'],
      handleLogin: () => {
        vscode.postMessage({
          command: 'loginGithub',
        });
      },
    });
    this.gitalk = _gitalk.render('gitalk-container');
  },
  _bind() {
    $('#treeList').on('click', '.stock-item', (e) => {
      const dataset = e.currentTarget.dataset;
      const id = dataset.id;
      const info = JSON.parse(dataset.info);
      const type = dataset.type;
      this._changeGitalkOption(info, type);
    });
  },
  _changeGitalkOption(stockInfo, type = 'stock') {
    this.options = {
      id: stockInfo.code,
      title: `「${stockInfo.name}」讨论主题`,
      body: '和气生财，友善发言',
      labels: ['discussions', type],
    };
    if (!this.gitalk) return this._initGitalk();
    if (!this.gitalk.state.user) return;

    /**
     * ! 用于网络延迟的问题，在异步请求过程中，用户快速点击切换个股
     * ! 很有可能会导致发起多次请求issue，多次创建同一issue的问题
     * ! 现在利用两个 Promise 变量 _currentTask 和 _nextTask 作为节流限制，避免发起多次并行请求
     * ! _currentTask 处于 pending 时，用户再次切换个股的操作会被赋值（覆盖）到 _nextTask，
     * ! 当 _currentTask 执行完后，会判断非空并执行 _nextTask。否则 _currentTask 赋值null，等待下一次切换。
     * !
     * ! 以上方法，实现了 _currentTask 未执行完，即使用户快速多次切换，_nextTask 也只会是 _currentTask 执行期间最后的一个。
     * ! 并且避免的网络延迟导致的并行请求引发的问题。
     */
    const exec = () => {
      return new Promise((resolve) => {
        this.gitalk.options = Object.assign(
          {},
          this.gitalk.options,
          this.options
        );
        this.gitalk.reset(() => {
          this.gitalk
            .getIssue()
            .then((issue) => {
              const lockKey = `${type}:${this.gitalk.options.id}`;
              if (!issue) {
                if (!this._createIssueLockMap[lockKey]) {
                  this._createIssueLockMap[lockKey] = true;
                  return this.createIssue().then(() => {
                    return this.getIssue();
                  });
                } else {
                  return this.getIssue();
                }
              }
              return issue;
            })
            .then((issue) => {
              this.gitalk.getComments(issue);
            })
            .then(() => {
              this.gitalk.setState({
                isIniting: false,
              });
              resolve();
            })
            .catch((err) => {
              console.error(err);
              resolve();
            });
        });
      }).then(() => {
        if (this._nextTask) {
          this._currentTask = this._nextTask();
          this._nextTask = null;
        } else {
          this._currentTask = null;
        }
      });
    };

    if (!this._currentTask) {
      this._currentTask = exec();
    } else {
      this._nextTask = exec;
    }
  },
  init() {
    this._bind();
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.command) {
        case 'setGithubAccessToken':
          this.accessToken = msg.data;
          break;
        case 'talkerReady':
          this.ready = true;
          this._initGitalk();
          break;
        case 'githubLoginSuccess':
          this._initGitalk();
      }
    });
  },
};

// Talker.init();

/** 提醒 */
const Viewer = {
  treeListCompiler: template.compile($('#stockItemTpl').html()),
  remindFieldsCompiler: template.compile($('#remindFieldTpl').html()),
  stockRemind: {},
  stockList: [],
  currentStockId: undef,
  /**
   * 绑定事件
   */
  _bind() {
    let currentStockId = this.currentStockId;
    $('#newRemindForm').on('submit', (e) => {
      e.preventDefault();
      var ro = (this.stockRemind[currentStockId] = this.stockRemind[
        currentStockId
      ] || {
        price: [],
        percent: [],
      });
      var newCfg = {
        price: [],
        percent: [],
        // 新增字段
        volume_ratio: undefined,
        price_change: undefined,
        high_break: false,
        low_break: false,
      };

      // 处理复选框
      newCfg.high_break = $('#newRemindForm input[name="high_break"]').is(':checked');
      newCfg.low_break = $('#newRemindForm input[name="low_break"]').is(':checked');

      $('#newRemindForm')
        .serializeArray()
        .forEach(({ name, value }) => {
          // 跳过复选框（已单独处理）
          if (name === 'high_break' || name === 'low_break') {
            return;
          }

          if (value) {
            if (!checkInputValue(value)) {
              vscode_alert(`输入的「${value}」格式不正确`);
              $(`input[name=${name}]`).focus();
              console.log('stockRemind: ', this.stockRemind);
              throw new Error(`输入的「${value}」格式不正确`);
            }

            // 处理基础价格/涨跌幅提醒
            if (name.endsWith('1') || name.endsWith('0')) {
              const type = name.substring(0, name.length - 1);
              const remindType = name.substring(name.length - 1);
              const signedValue = (remindType === '1' ? '+' : '-') + value;

              if (this.stockRemind[currentStockId][type]?.indexOf(signedValue) > -1) {
                vscode_alert(`输入的设置已经存在`);
                $(`input[name=${name}]`).focus();
                throw new Error(`输入的设置已经存在`);
              }
              newCfg[type].push(signedValue);
            } else if (name === 'volume_ratio') {
              // 成交量放大倍数
              const ratio = parseFloat(value);
              if (ratio > 0) {
                newCfg.volume_ratio = ratio;
              }
            } else if (name === 'price_change') {
              // 价格变动阈值
              const change = parseFloat(value);
              if (change > 0) {
                newCfg.price_change = change;
              }
            }
          }
        });

      $('#newRemindForm')[0].reset();
      // 取消选中复选框
      $('#newRemindForm input[type="checkbox"]').prop('checked', false);
      $('.reminds-box').removeClass('reminds-box_add');

      // 合并配置
      if (newCfg.price.length) {
        ro.price = ro.price || [];
        ro.price.push(...newCfg.price);
      }
      if (newCfg.percent.length) {
        ro.percent = ro.percent || [];
        ro.percent.push(...newCfg.percent);
      }
      if (newCfg.volume_ratio !== undefined) {
        ro.volume_ratio = newCfg.volume_ratio;
      }
      if (newCfg.price_change !== undefined) {
        ro.price_change = newCfg.price_change;
      }
      if (newCfg.high_break) {
        ro.high_break = true;
      }
      if (newCfg.low_break) {
        ro.low_break = true;
      }

      this.updateTreeList();
      this.renderRemindFields(currentStockId);
      this.saveStockRemind();
    });

    $('#appendRemindBtn').click(() => {
      $('.reminds-box').addClass('reminds-box_add');
    });

    $('#cancelAppendRemindBtn').click(() => {
      $('.reminds-box').removeClass('reminds-box_add');
      $('#newRemindForm')[0].reset();
    });

    $('#treeList').on('click', '.stock-item', (e) => {
      const dataset = e.currentTarget.dataset;
      const id = dataset.id;
      const info = JSON.parse(dataset.info);
      currentStockId = this.currentStockId = id;
      this.renderRemindFields(id);
      $('#currentStockName').text(info.name);
      $('#currentStockNum').text(info.code.toUpperCase());
      $('#cancelAppendRemindBtn').click();
    });

    $('#remindFields')
      .on('click', '.remove', (e) => {
        const dataset = e.currentTarget.dataset;
        const type = dataset.type;
        const index = dataset.index;

        if (['volume_ratio', 'price_change', 'high_break', 'low_break'].includes(type)) {
          // 删除智能提醒字段
          delete this.stockRemind[currentStockId][type];
        } else {
          // 删除基础价格/涨跌幅提醒
          $('#field_' + type + '_' + index).remove();
          this.stockRemind[currentStockId][type].splice(index, 1);
        }

        this.renderRemindFields(currentStockId);
        console.log('stockRemind: ', this.stockRemind);
        this.saveStockRemind();
      })
      .on('change', 'input', (e) => {
        console.log('e: ', e);
        const dataset = e.currentTarget.dataset;
        const type = dataset.type;
        const index = dataset.index;
        const remindType = dataset.remindType;
        let value = e.currentTarget.value;
        if (!checkInputValue(value)) {
          vscode_alert(`输入的「${value}」格式不正确`);
          return;
        }
        value = (remindType === '1' ? '+' : '-') + value;
        if (this.stockRemind[currentStockId][type].indexOf(value) > -1) {
          vscode_alert(`输入的设置已经存在`);
          return;
        }
        this.stockRemind[currentStockId][type][index] = value;
        console.log('stockRemind: ', this.stockRemind);
        this.saveStockRemind();
      });
  },
  /**
   * 定义模板的方法
   */
  _defindeTemplateImports() {
    template.defaults.imports.formatRemindValue = function (value) {
      const symbol = String(value)[0];
      if (/[+-]/.test(symbol)) {
        return String(value).substr(1);
      } else {
        return value;
      }
    };
    template.defaults.imports.remindType = function (value) {
      const symbol = String(value)[0];
      return symbol === '-' ? 0 : 1;
    };
    template.defaults.imports.remindLabel = function (type, value) {
      const symbol = String(value)[0];
      switch (type) {
        case 'price':
          return '股价' + (symbol === '-' ? '下跌' : '上涨') + '到';
        case 'percent':
          return '日' + (symbol === '-' ? '跌幅' : '涨幅') + '达';
          break;
      }
    };
  },
  /**
   * 保存提醒配置
   */
  saveStockRemind: _.debounce(function () {
    vscode.postMessage({
      command: 'saveRemind',
      data: JSON.stringify(this.stockRemind),
    });
  }, 300),
  /**
   * 渲染提醒设置
   * @param {*} stockId
   */
  renderRemindFields(stockId) {
    const ro = this.stockRemind[stockId];
    if (!ro) {
      $('#remindFields').html('请先添加提醒');
      return;
    }

    let html = '';

    // 价格提醒
    if (ro.price && ro.price.length) {
      html += this.remindFieldsCompiler({
        data: ro.price,
        type: 'price',
        unit: '元',
      });
    }

    // 涨跌幅提醒
    if (ro.percent && ro.percent.length) {
      html += this.remindFieldsCompiler({
        data: ro.percent,
        type: 'percent',
        unit: '%',
      });
    }

    // 成交量放大提醒
    if (ro.volume_ratio) {
      html += `<label class="d-input remind-item">
        <span class="label">成交量放大</span>
        <span class="remind-value">${ro.volume_ratio} 倍</span>
        <span class="remove" data-type="volume_ratio">&times;</span>
      </label>`;
    }

    // 价格变动提醒
    if (ro.price_change) {
      html += `<label class="d-input remind-item">
        <span class="label">价格变动超</span>
        <span class="remind-value">${ro.price_change} 元</span>
        <span class="remove" data-type="price_change">&times;</span>
      </label>`;
    }

    // 突破日内高点提醒
    if (ro.high_break) {
      html += `<label class="d-input remind-item">
        <span class="label">突破日内高点</span>
        <span class="remind-value">已开启</span>
        <span class="remove" data-type="high_break">&times;</span>
      </label>`;
    }

    // 跌破日内低点提醒
    if (ro.low_break) {
      html += `<label class="d-input remind-item">
        <span class="label">跌破日内低点</span>
        <span class="remind-value">已开启</span>
        <span class="remove" data-type="low_break">&times;</span>
      </label>`;
    }

    if (!html) {
      html = '请先添加提醒';
    }

    $('#remindFields').html(html);
    $('#remindFields').width();
  },
  /**
   * 渲染个股列表
   * @param {} stockList
   */
  updateTreeList(stockList = this.stockList || []) {
    const fillRemindCount = (info) => {
      var ro;
      if ((ro = this.stockRemind[info.id])) {
        // 计算提醒数量：价格提醒 + 涨跌幅提醒 + 智能提醒
        let count = (ro.price?.length || 0) + (ro.percent?.length || 0);
        if (ro.volume_ratio) count++;
        if (ro.price_change) count++;
        if (ro.high_break) count++;
        if (ro.low_break) count++;
        info.remindCount = count;
      } else {
        info.remindCount = 0;
      }
    };
    stockList.forEach(fillRemindCount);
    // stockList.sort((a, b) => b.remindCount - a.remindCount);
    $('#treeList').html(this.treeListCompiler({ stockList: stockList }));
    if (!this.currentStockId) {
      $('#treeList .stock-item:eq(1)').click();
    }
  },
  init() {
    this._defindeTemplateImports();
    this._bind();
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.command) {
        case 'updateStockList':
          this.updateTreeList((this.stockList = msg.data));
          break;
        case 'updateStockRemind':
          this.stockRemind = msg.data;
          this.currentStockId && this.renderRemindFields(this.currentStockId);
          break;
      }
    });
  },
};
Viewer.init();

vscode.postMessage({
  command: 'pageReady',
});

// 社区
document.querySelector('#tucaoBtn').onclick = function () {
  vscode.postMessage({
    command: 'tucaoForum',
  });
};

/**
 * 技术分析模块
 */
const TechAnalysis = {
  chart: null,
  currentCode: null,
  currentPeriod: 'daily',
  klineData: [],
  _bind() {
    // K线周期切换
    $('.kline-tab').on('click', (e) => {
      const $btn = $(e.currentTarget);
      const period = $btn.data('period');

      $('.kline-tab').removeClass('active');
      $btn.addClass('active');

      this.currentPeriod = period;
      this.loadKlineData();
    });
  },
  /**
   * 显示技术分析区域
   */
  show(code) {
    if (this.currentCode === code && $('#techAnalysisSection').is(':visible')) {
      return;
    }

    this.currentCode = code;
    $('#techAnalysisSection').show();

    if (!this.chart) {
      this.initChart();
    }

    this.loadKlineData();
  },
  /**
   * 隐藏技术分析区域
   */
  hide() {
    $('#techAnalysisSection').hide();
  },
  /**
   * 初始化图表
   */
  initChart() {
    this.chart = echarts.init(document.getElementById('klineChart'));
    window.addEventListener('resize', () => {
      this.chart && this.chart.resize();
    });
  },
  /**
   * 加载K线数据
   */
  loadKlineData: _.debounce(function () {
    const self = TechAnalysis;
    if (!self.currentCode) return;

    $('#klineLoading').show();

    vscode.postMessage({
      command: 'getKlineData',
      code: self.currentCode,
      period: self.currentPeriod,
      count: 100,
    });
  }, 300),
  /**
   * 更新K线数据并渲染图表
   */
  updateKlineData(data) {
    $('#klineLoading').hide();

    if (!data || !data.length) {
      this.showNoData();
      return;
    }

    this.klineData = data;
    this.renderChart(data);
    this.updateIndicators(data);
  },
  /**
   * 显示无数据提示
   */
  showNoData() {
    $('#klineChart').html('<div class="no-data-tip">暂无可用数据</div>');
    $('#maValue').text('--');
    $('#rsiValue').text('--');
    $('#macdValue').text('--');
    $('#bollValue').text('--');
  },
  /**
   * 渲染K线图表
   */
  renderChart(data) {
    if (!this.chart) return;

    // 提取数据
    const dates = data.map((d) => d.date);
    const candles = data.map((d) => [d.open, d.close, d.low, d.high]);
    const volumes = data.map((d) => d.volume);

    // 计算均线
    const closes = data.map((d) => d.close);
    const ma5 = this.calculateMA(closes, 5);
    const ma10 = this.calculateMA(closes, 10);
    const ma20 = this.calculateMA(closes, 20);
    const ma60 = this.calculateMA(closes, 60);

    const option = {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        confine: true,
      },
      legend: {
        data: ['K线', 'MA5', 'MA10', 'MA20', 'MA60'],
        top: 5,
        textStyle: { color: '#abb2bf' },
      },
      grid: [
        { left: 60, right: 20, top: 40, height: '60%' },
        { left: 60, right: 20, bottom: 30, height: '20%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          gridIndex: 0,
          axisLine: { lineStyle: { color: '#3e4451' } },
          axisLabel: { color: '#808a9e', show: false },
        },
        {
          type: 'category',
          data: dates,
          gridIndex: 1,
          axisLine: { lineStyle: { color: '#3e4451' } },
          axisLabel: { color: '#808a9e' },
        },
      ],
      yAxis: [
        {
          scale: true,
          gridIndex: 0,
          splitLine: { lineStyle: { color: '#3e4451' } },
          axisLine: { lineStyle: { color: '#3e4451' } },
          axisLabel: { color: '#808a9e' },
        },
        {
          scale: true,
          gridIndex: 1,
          splitLine: { lineStyle: { color: '#3e4451' } },
          axisLine: { lineStyle: { color: '#3e4451' } },
          axisLabel: { color: '#808a9e' },
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 70, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1], bottom: 5 },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: candles,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: {
            color: '#e06c75', // 上涨红色
            color0: '#98c379', // 下跌绿色
            borderColor: '#e06c75',
            borderColor0: '#98c379',
          },
        },
        {
          name: 'MA5',
          type: 'line',
          data: ma5,
          xAxisIndex: 0,
          yAxisIndex: 0,
          smooth: true,
          lineStyle: { width: 1, color: '#ff6b6b' },
          symbol: 'none',
        },
        {
          name: 'MA10',
          type: 'line',
          data: ma10,
          xAxisIndex: 0,
          yAxisIndex: 0,
          smooth: true,
          lineStyle: { width: 1, color: '#ffd93d' },
          symbol: 'none',
        },
        {
          name: 'MA20',
          type: 'line',
          data: ma20,
          xAxisIndex: 0,
          yAxisIndex: 0,
          smooth: true,
          lineStyle: { width: 1, color: '#6bcb77' },
          symbol: 'none',
        },
        {
          name: 'MA60',
          type: 'line',
          data: ma60,
          xAxisIndex: 0,
          yAxisIndex: 0,
          smooth: true,
          lineStyle: { width: 1, color: '#4d96ff' },
          symbol: 'none',
        },
        {
          name: '成交量',
          type: 'bar',
          data: volumes,
          xAxisIndex: 1,
          yAxisIndex: 1,
          itemStyle: {
            color: (params) => {
              const idx = params.dataIndex;
              const open = data[idx]?.open || 0;
              const close = data[idx]?.close || 0;
              return close >= open ? '#e06c7555' : '#98c37955';
            },
          },
        },
      ],
    };

    this.chart.setOption(option, true);
  },
  /**
   * 计算移动平均线
   */
  calculateMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push('-');
      } else {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += data[i - j];
        }
        result.push((sum / period).toFixed(2));
      }
    }
    return result;
  },
  /**
   * 更新技术指标显示
   */
  updateIndicators(data) {
    if (!data || !data.length) return;

    const closes = data.map((d) => d.close);
    const latest = data[data.length - 1];

    // 计算 MA
    const ma5 = this.calculateMAValue(closes, 5);
    const ma10 = this.calculateMAValue(closes, 10);
    const ma20 = this.calculateMAValue(closes, 20);
    const ma60 = this.calculateMAValue(closes, 60);

    $('#maValue').text(`${ma5} / ${ma10} / ${ma20} / ${ma60}`);
    $('#maValue').removeClass('up down');
    if (latest.close >= ma20) {
      $('#maValue').addClass('up');
    } else {
      $('#maValue').addClass('down');
    }

    // 计算 RSI
    const rsi6 = this.calculateRSI(closes, 6);
    const rsi12 = this.calculateRSI(closes, 12);
    const rsi24 = this.calculateRSI(closes, 24);

    $('#rsiValue').text(`${rsi6} / ${rsi12} / ${rsi24}`);
    $('#rsiValue').removeClass('up down');
    if (rsi24 > 70) {
      $('#rsiValue').addClass('up').attr('title', '超买区域');
    } else if (rsi24 < 30) {
      $('#rsiValue').addClass('down').attr('title', '超卖区域');
    }

    // 计算 MACD
    const macd = this.calculateMACD(closes);
    if (macd.dif !== '--' && macd.bar !== '--') {
      $('#macdValue').text(`${macd.dif} / ${macd.dea} / ${macd.bar}`);
      $('#macdValue').removeClass('up down');
      if (parseFloat(macd.bar) > 0) {
        $('#macdValue').addClass('up');
      } else {
        $('#macdValue').addClass('down');
      }
    } else {
      $('#macdValue').text('--');
    }

    // 计算布林带
    const boll = this.calculateBOLL(closes);
    $('#bollValue').text(`${boll.upper} / ${boll.middle} / ${boll.lower}`);
    $('#bollValue').removeClass('up down');
    if (latest.close > parseFloat(boll.upper)) {
      $('#bollValue').addClass('up').attr('title', '突破上轨');
    } else if (latest.close < parseFloat(boll.lower)) {
      $('#bollValue').addClass('down').attr('title', '跌破下轨');
    }
  },
  /**
   * 计算均线值
   */
  calculateMAValue(data, period) {
    if (data.length < period) return '--';
    let sum = 0;
    for (let i = data.length - period; i < data.length; i++) {
      sum += data[i];
    }
    return (sum / period).toFixed(2);
  },
  /**
   * 计算 RSI
   */
  calculateRSI(data, period = 14) {
    if (data.length < period + 1) return '--';

    const changes = [];
    for (let i = 1; i < data.length; i++) {
      changes.push(data[i] - data[i - 1]);
    }

    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = period; i < changes.length; i++) {
      avgGain = (avgGain * (period - 1) + (changes[i] > 0 ? changes[i] : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (changes[i] < 0 ? Math.abs(changes[i]) : 0)) / period;
    }

    if (avgLoss === 0) return '100';
    const rs = avgGain / avgLoss;
    return (100 - 100 / (1 + rs)).toFixed(2);
  },
  /**
   * 计算 MACD
   */
  calculateMACD(data, fast = 12, slow = 26, signal = 9) {
    if (data.length < slow) return { dif: '--', dea: '--', bar: '--' };

    const emaFast = this.calculateEMA(data, fast);
    const emaSlow = this.calculateEMA(data, slow);
    const dif = emaFast - emaSlow;
    const dea = this.calculateEMA([dif], signal)[0] || dif;
    const bar = (dif - dea) * 2;

    return {
      dif: dif.toFixed(3),
      dea: dea.toFixed(3),
      bar: bar.toFixed(3),
    };
  },
  /**
   * 计算 EMA
   */
  calculateEMA(data, period) {
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }
    return ema;
  },
  /**
   * 计算布林带
   */
  calculateBOLL(data, period = 20, stdDev = 2) {
    if (data.length < period) return { upper: '--', middle: '--', lower: '--' };

    const recent = data.slice(-period);
    const middle = recent.reduce((a, b) => a + b, 0) / period;

    let sum = 0;
    for (const v of recent) {
      sum += Math.pow(v - middle, 2);
    }
    const std = Math.sqrt(sum / period);

    return {
      upper: (middle + stdDev * std).toFixed(2),
      middle: middle.toFixed(2),
      lower: (middle - stdDev * std).toFixed(2),
    };
  },
  init() {
    this._bind();
    // 监听后端消息
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'klineDataReady') {
        this.updateKlineData(msg.data);
      }
    });
  },
};

// 初始化技术分析模块
TechAnalysis.init();

// 在 Viewer 中添加股票切换时的处理
const originalViewerInit = Viewer.init;
Viewer.init = function () {
  originalViewerInit.call(this);

  // 原有代码会在这里执行
  // 添加股票切换时显示技术分析
  const originalUpdateTreeList = this.updateTreeList;
  this.updateTreeList = function (stockList) {
    originalUpdateTreeList.call(this, stockList);
  };

  // 在选择股票时显示技术分析
  $('#treeList').on('click', '.stock-item[data-type="stock"]', (e) => {
    const dataset = e.currentTarget.dataset;
    const info = JSON.parse(dataset.info);
    TechAnalysis.show(info.code);
  });
};
