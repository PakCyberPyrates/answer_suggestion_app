import BaseApp from 'base_app';
import helpers from 'helpers';

const App = {
  defaultState: 'spinner',
  defaultNumberOfEntriesToDisplay: 10,
  zendeskRegex: /^https:\/\/(.*?)\.(?:zendesk|zd-(?:dev|master|staging))\.com\//,
  DEFAULT_LOGO_URL: '/images/logo_placeholder.png',

  events: {
    // APP EVENTS
    'app.created': 'created',
    'ticket.subject.changed': _.debounce(function(){ this.initialize(); }, 500),

    // AJAX EVENTS
    'searchHelpCenter.done': 'searchHelpCenterDone',
    'getHcArticle.done': 'getHcArticleDone',
    'getSectionAccessPolicy.done': 'getSectionAccessPolicyDone',

    // DOM EVENTS
    'click body': 'closeMenus',
    'click a.preview_link': 'previewLink',
    'click a.copy_link': 'copyLink',
    'click .brand-filter .c-menu__item': 'processSearchFromInput',
    'click .locale-filter .c-menu__item': 'processSearchFromInput',
    'click .js-menu': 'openActionMenu',
    'click .c-txt__input--select': 'toggleSelect',
    //rich text editor has built in drag and drop of links so we should only fire
    //the dragend event when users are using Markdown or text.
    'dragend': function(event){ if (!this.useRichText) this.copyLink(event); },
    'keyup .custom-search input': function(event){
      if (event.keyCode === 13) { return this.processSearchFromInput(); }
    },
    'click .btn.search': 'processSearchFromInput'
  },

  requests: {
    settings: {
      url: '/api/v2/account/settings.json',
      type: 'GET'
    },

    getBrands: {
      url: '/api/v2/brands.json',
      type: 'GET'
    },

    getLocales: {
      url: '/api/v2/locales.json',
      type: 'GET'
    },

    getHcArticle: function(id) {
      return {
        url: helpers.fmt('/api/v2/help_center/articles/%@.json?include=translations', id),
        type: 'GET'
      };
    },

    getSectionAccessPolicy: function(sectionId) {
      return {
        url: helpers.fmt('/api/v2/help_center/sections/%@/access_policy.json', sectionId),
        type: 'GET'
      };
    },

    searchHelpCenter: function(query) {
      var url = '/api/v2/help_center/articles/search.json',
          data = {
            per_page: this.queryLimit(),
            query: query
          };

      if (this.isMultilocale) {
        data.locale = this.getLocaleFilterValue();
      }

      if (this.isMultibrand) {
        url = '/api/v2/search.json';
        data.brand_id = this.getBrandFilterValue();
        data.query = 'type:article ' + data.query;

        if (data.brand_id !== 'any') {
          data.query = 'brand:' + data.brand_id + ' ' + data.query;
        }
      }

      return {
        type: 'GET',
        url: url,
        data: data
      };
    }
  },

  getBrandFilterValue: function() {
    return this.$('#brand-filter').attr('data-val');
  },

  getLocaleFilterValue: function() {
    return this.$('#locale-filter').attr('data-val');
  },

  search: function(query) {
    this.switchTo('spinner');

    this.ajax('searchHelpCenter', query);
  },

  created: function() {
    this.isMultilocale = false;
    this.isMultibrand = false;

    this.when(
      this.ajax('getBrands'),
      this.ajax('getLocales')
    ).then(function(brandsData, localeData) {
      var brands = this.filterBrands(brandsData.brands);
      this.isMultibrand = brands.length > 1;

      /* if multibrand, you can't search for locales because the HC API doesn't support that */
      this.isMultilocale = !this.isMultibrand && localeData.count > 1;

      if (this.isMultibrand) { this.getBrandsDone(brandsData); }
      if (this.isMultilocale) { this.getLocalesDone(localeData); }
    }.bind(this));

    this.initialize();
  },

  initialize: function(){
    this.$('.search-input').attr('placeholder', this.I18n.t('layout.placeholder_text'));

    this.useRichTextPromise = this.zafClient.get('ticket.comment.useRichText').then(data => {
      return data['ticket.comment.useRichText'];
    });

    this.currentUserLocalePromise = this.zafClient.get('currentUser.locale').then(user => {
      return user['currentUser.locale'];
    });

    this.ticketSubjectPromise = this.zafClient.get('ticket.subject').then(data => {
      return data['ticket.subject'];
    });

    this.useMarkdownPromise = this.ajax('settings').then(data => {
      return data.settings.tickets.markdown_ticket_comments;
    });

    this.ticketSubjectPromise.then((ticketSubject) => {
      if (_.isEmpty(ticketSubject)) {
        return this.switchTo('no_subject');
      }

      var subject = this.subjectSearchQuery(ticketSubject);
      if (subject) {
        this.search(subject);
      } else {
        this.switchTo('list');
      }
    });
  },

  hcArticleLocaleContent: function(data) {
    return this.currentUserLocalePromise.then((currentUserLocale) => {
      var currentLocale = this.isMultilocale ? this.getLocaleFilterValue() : currentUserLocale,
      translations = data.article.translations;

      var localizedTranslation = _.find(translations, function(translation) {
        return translation.locale.toLowerCase() === currentLocale.toLowerCase();
      });

      return localizedTranslation && localizedTranslation.body || translations[0].body;
    });
  },

  renderAgentOnlyAlert: function() {
    var alert = this.renderTemplate('alert');
    this.$('#detailsModal .modal-body').prepend(alert);
  },

  isAgentOnlyContent: function(data) {
    return data.agent_only || data.access_policy && data.access_policy.viewable_by !== 'everybody';
  },

  getBrandsDone: function(data) {
    var filteredBrands = this.filterBrands(data.brands);
    if (this.isMultibrand) {
      var options = _.map(filteredBrands, function(brand) {
        return { value: brand.id, label: brand.name };
      });
      this.$('.custom-search').before(
        this.renderTemplate('brand_filter', { options: options })
      );
    }

    this.brandsInfo = _.object(_.map(filteredBrands, function(brand) {
      return [brand.name, brand.logo && brand.logo.content_url];
    }));
  },

  getLocalesDone: function(data) {
    if (!this.isMultilocale) return;

    this.zafClient.get('currentUser.locale').then(user => {
      var options = _.map(data.locales, function(locale) {
        var data = {
          value: locale.locale,
          label: locale.presentation_name
        };
        if (user['currentUser.locale'] === locale.locale) { data.selected = 'is-selected'; }
        return data;
      }, this);

      this.$('.custom-search').before(
        this.renderTemplate('locale_filter', { options: options })
      );
    });
  },

  getHcArticleDone: function(data) {
    if (data.article && data.article.section_id) {
      this.ajax('getSectionAccessPolicy', data.article.section_id);
    }

    this.hcArticleLocaleContent(data).then(modalContent => {
      this.updateModalContent(modalContent);
    });
  },

  updateModalContent: function(modalContent) {
    this.$('#detailsModal .modal-body .content-body').html(modalContent);
  },

  getSectionAccessPolicyDone: function(data) {
    if (this.isAgentOnlyContent(data)) { this.renderAgentOnlyAlert(); }
  },

  searchHelpCenterDone: function(data) {
    this.renderList(this.formatHcArticles(data.results));
  },

  renderList: function(data){
    if (_.isEmpty(data.articles)) {
      this.switchTo('no_articles');
    } else {
      this.switchTo('list', data);
      this.$('.brand-logo').tooltip();
    }
  },

  toggleSelect: function(event) {
    var $select = this.$(event.target).closest('.c-txt__input--select');
    var $menu = $select.parent().siblings('.c-menu');
    this.closeActionMenus();
    $select.toggleClass('is-open');
    $menu.toggleClass('is-open', $select.hasClass('is-open'));

    if ($menu.hasClass('is-open')) {
      $menu.parent('.u-position-relative').css('zIndex', 1);
      $menu.show();
    } else {
      $menu.hide();
      $menu.parent('.u-position-relative').css('zIndex', '');
    }

    return false;
  },

  formatHcArticles: function(result){
    var slicedResult = result.slice(0, this.numberOfDisplayableArticles());
    var articles = _.inject(slicedResult, function(memo, article) {
      var zendeskUrl = article.html_url.match(this.zendeskRegex),
          subdomain = zendeskUrl && zendeskUrl[1];

      memo.push({
        id: article.id,
        url: article.html_url,
        title: article.name,
        subdomain: subdomain,
        body: article.body,
        brandName: article.brand_name,
        brandLogo: this.brandsInfo && this.brandsInfo[article.brand_name] || this.DEFAULT_LOGO_URL,
        isMultibrand: this.isMultibrand
      });
      return memo;
    }, [], this);

    return { articles: articles };
  },

  processSearchFromInput: function() {
    this.ticketSubjectPromise.then((ticketSubject) => {
      if (_.isEmpty(ticketSubject)) {
        return this.switchTo('no_subject');
      }

      var query = this.removePunctuation(this.$('.custom-search input').val()),
          subjectSearchQuery = this.subjectSearchQuery(ticketSubject);

      if (query && query.length) {
        this.search(query);
      } else if(subjectSearchQuery) {
        this.search(subjectSearchQuery);
      }
    });
  },

  previewLink: function(event){
    event.preventDefault();
    var $link = this.$(event.target).closest('a');
    $link.parent().parent().parent().removeClass('open');
    var $modal = this.$("#detailsModal");
    $modal.html(this.renderTemplate('modal', {
      title: $link.closest('.article').data('title'),
      link: $link.attr('href')
    }));
    $modal.modal();
    this.getContentFor($link);
  },

  copyLink: function(event) {
    event.preventDefault();
    var content = "";

    var title = event.target.title;
    var link = event.target.href;

    this.when(
      this.useRichTextPromise,
      this.useMarkdownPromise,
    ).then((useRichText, useMarkdown) => {
      if (useMarkdown) {
        content = helpers.fmt("[%@](%@)", title, link);
      }
      else if (useRichText){
        content = helpers.fmt("<a href='%@' target='_blank'>%@</a>", _.escape(link), _.escape(title));
      }
      else {
        if (this.setting('include_title')) {
          content = title + ' - ';
        }
        content += link;
      }
      this.appendToComment(content);
    });
  },

  getContentFor: function($link) {
    this.zafClient.get('currentAccount.subdomain').then(data => {
      var subdomain = $link.data('subdomain'),
          currentAccountSubdomain = data['currentAccount.subdomain'];

      if (!subdomain || subdomain !== currentAccountSubdomain) {
        this.updateModalContent($link.data('articleBody'));
      } else {
        this.ajax('getHcArticle', $link.data('id'));
      }
    });
  },

  appendToComment: function(text){
    this.useRichTextPromise.then((useRichText) => {
      useRichText ? this.zafClient.invoke('comment.appendHtml', text) : this.zafClient.invoke('comment.appendText', text);
    });
  },

  stop_words: _.memoize(function(){
    return _.map(this.I18n.t("stop_words").split(','), function(word) { return word.trim(); });
  }),

  numberOfDisplayableArticles: function(){
    return this.setting('nb_entries') || this.defaultNumberOfEntriesToDisplay;
  },

  queryLimit: function(){
    return this.numberOfDisplayableArticles();
  },

  removeStopWords: function(str, stop_words){
    // Remove punctuation and trim
    str = this.removePunctuation(str);
    var words = str.match(/[^\s]+|\s+[^\s+]$/g);
    var x,y = 0;

    for(x=0; x < words.length; x++) {
      // For each word, check all the stop words
      for(y=0; y < stop_words.length; y++) {
        // Get the current word
        var word = words[x].replace(/\s+|[^a-z]+\'/ig, "");

        // Get the stop word
        var stop_word = stop_words[y];

        // If the word matches the stop word, remove it from the keywords
        if(word.toLowerCase() == stop_word) {
          // Build the regex
          var regex_str = "^\\s*"+stop_word+"\\s*$";// Only word
          regex_str += "|^\\s*"+stop_word+"\\s+";// First word
          regex_str += "|\\s+"+stop_word+"\\s*$";// Last word
          regex_str += "|\\s+"+stop_word+"\\s+";// Word somewhere in the middle

          var regex = new RegExp(regex_str, "ig");

          str = str.replace(regex, " ");
        }
      }
    }

    return str.trim();
  },

  removePunctuation: function(str){
    return str.replace(/[\.,-\/#!$%\^&\*;:{}=\-_`~()]/g," ")
      .replace(/\s{2,}/g," ");
  },

  subjectSearchQuery: function(ticketSubject){
    if (ticketSubject) { return this.removeStopWords(ticketSubject, this.stop_words()); }
  },

  filterBrands: function(brands){
    return _.filter(brands, function(element){
      return element.active && element.help_center_state === "enabled";
    });
  },

  openActionMenu: function(event) {
    event.preventDefault();

    this.closeInputSelects();

    var $this = this.$(event.target).closest('a'),
        elementBottom = $this.parent().position().top + $this.parent().outerHeight(true),
        distanceToDocumentBottom = $(document).height() - elementBottom;

    var $menu = $this.parent().find('.c-menu');
    $menu.css({ 'visibility':'hidden' });
    var menuHeight = $menu.height(),
        canFitBelow = distanceToDocumentBottom > (menuHeight + 20);

    $menu.removeAttr('style');

    if ($this.hasClass('is-active')) {
      this.closeActionMenus();
    } else {
      this.closeActionMenus();
      $this.parent().find('.c-menu')
        .addClass('is-open')
        .attr('aria-hidden', false);

      $this.addClass('is-active');

      if (canFitBelow) {
        $this.parent().find('.c-menu').removeClass('c-arrow--b c-menu--up').addClass('c-arrow--t c-menu--down');
      }
    }

    return false;
  },

  closeMenus: function() {
    this.closeInputSelects();
    this.closeActionMenus();
  },

  closeInputSelects: function() {
    var $menus = this.$('.c-txt__input--select'),
        $dropdownOptions = $menus.parent().siblings('.c-menu');

    $menus.removeClass('is-open');

    $dropdownOptions.removeClass('is-open').hide().parent('.u-position-relative').css('zIndex', '');
  },

  closeActionMenus: function() {
    this.$('.c-menu').removeClass('is-open').each(function() {
      this.offsetHeight; // trigger reflow
    }).attr('aria-hidden', true);
    this.$('.js-menu').removeClass('is-active');
  }
};

export default BaseApp.extend(App);