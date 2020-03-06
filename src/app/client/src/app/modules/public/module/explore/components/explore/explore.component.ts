import { combineLatest, Subject } from 'rxjs';
import { OrgDetailsService, UserService, SearchService, FrameworkService } from '@sunbird/core';
import { PublicPlayerService } from './../../../../services';
import { Component, OnInit, OnDestroy, EventEmitter, HostListener, AfterViewInit } from '@angular/core';
import {
  ResourceService, ToasterService, ConfigService, NavigationHelperService } from '@sunbird/shared';
import { Router, ActivatedRoute } from '@angular/router';
import * as _ from 'lodash-es';
import { IInteractEventEdata, IImpressionEventInput } from '@sunbird/telemetry';
import { takeUntil, map, mergeMap, first, filter, tap } from 'rxjs/operators';
import { ContentSearchService } from '@sunbird/content-search';

@Component({
  selector: 'app-explore-component',
  templateUrl: './explore.component.html'
})
export class ExploreComponent implements OnInit, OnDestroy, AfterViewInit {

  public showLoader = true;
  public noResultMessage;
  public apiContentList: Array<any> = [];
  public filters;
  public unsubscribe$ = new Subject<void>();
  public telemetryImpression: IImpressionEventInput;
  public inViewLogs = [];
  public sortIntractEdata: IInteractEventEdata;
  public dataDrivenFilterEvent = new EventEmitter();
  public pageSections: Array<any> = [];
  selectedFilters = {
    board: 'State (Assam)',
    class: '',
    medium: ''
  };

  @HostListener('window:scroll', []) onScroll(): void {
    if ((window.innerHeight + window.scrollY) >= (document.body.offsetHeight * 2 / 3)
      && this.pageSections.length < this.apiContentList.length) {
      this.pageSections.push(this.apiContentList[this.pageSections.length]);
    }
  }
  constructor(private searchService: SearchService, private toasterService: ToasterService,
    public resourceService: ResourceService, private configService: ConfigService, private activatedRoute: ActivatedRoute,
    public router: Router, private orgDetailsService: OrgDetailsService, private publicPlayerService: PublicPlayerService,
    private contentSearchService: ContentSearchService,
    public frameworkService: FrameworkService, public navigationhelperService: NavigationHelperService) {
    this.router.onSameUrlNavigation = 'reload';
  }
  getChannelId() {
    if (this.activatedRoute.snapshot.params.slug) {
      return this.orgDetailsService.getOrgDetails(this.activatedRoute.snapshot.params.slug)
      .pipe(map(((orgDetails: any) => {
        return { channelId: orgDetails.hashTagId, custodianOrg: false};
      })));
    } else {
      return this.orgDetailsService.getCustodianOrg().pipe(map(((custOrgDetails: any) => {
        return { channelId: _.get(custOrgDetails, 'result.response.value'), custodianOrg: true };
      })));
    }
  }
  fetchFilters() {
    this.contentSearchService.filterData$.pipe(takeUntil(this.unsubscribe$)).subscribe((filters) => {
      console.log('filters', filters);
      if (filters.data) {
        this.filters = filters.data;
      }
    });
  }
  ngOnInit() {
    this.getChannelId().pipe(takeUntil(this.unsubscribe$)).subscribe(({channelId, custodianOrg}) => {
      console.log('===channelId, custodianOrg===', channelId, custodianOrg, this.activatedRoute.snapshot.params.slug);
      this.contentSearchService.initialize(channelId, custodianOrg, this.selectedFilters.board);
      this.fetchFilters();
    });
    this.dataDrivenFilterEvent.subscribe((filters: any) => {
      this.selectedFilters = filters;
      this.showLoader = true;
      this.apiContentList = [];
      this.pageSections = [];
      this.fetchPageData();
      this.setNoResultMessage();
    }, error => {
      this.router.navigate(['']);
    });
  }

  public getFilters(filters) {
    this.dataDrivenFilterEvent.emit(_.pick(filters, ['board', 'medium', 'gradeLevel']));
  }
  getSearchRequest() {
    let filters = this.selectedFilters;
    filters = _.omit(filters, ['key', 'sort_by', 'sortType', 'appliedFilters']);
    filters['contentType'] = ['TextBook']; // ['Collection', 'TextBook', 'LessonPlan', 'Resource'];
    const option = {
        limit: 100 || this.configService.appConfig.SEARCH.PAGE_LIMIT,
        filters: filters,
        // mode: 'soft',
        // facets: facets,
        params: _.cloneDeep(this.configService.appConfig.ExplorePage.contentApiQueryParams),
    };
    if (this.contentSearchService.frameworkId) {
      option.params.framework = this.contentSearchService.frameworkId;
    }
    return option;
  }
  private fetchPageData() {
    const option = this.getSearchRequest();
    this.searchService.contentSearch(option).pipe(
      map((response) => {
        const filteredContents = _.omit(_.groupBy(_.get(response, 'result.content'), 'subject'), ['undefined']);
      for (const [key, value] of Object.entries(filteredContents)) {
        const isMultipleSubjects = key.split(',').length > 1;
        if (isMultipleSubjects) {
            const subjects = key.split(',');
            subjects.forEach((subject) => {
                if (filteredContents[subject]) {
                    filteredContents[subject] = _.uniqBy(filteredContents[subject].concat(value), 'identifier');
                } else {
                    filteredContents[subject] = value;
                }
            });
            delete filteredContents[key];
        }
      }
      const sections = [];
      for (const section in filteredContents) {
        if (section) {
            sections.push({
                name: section,
                contents: filteredContents[section]
            });
        }
      }
      return _.map(sections, (section) => {
        _.forEach(section.contents, contents => {
          contents.cardImg = contents.appIcon || 'assets/images/book.png';
        });
        return section;
      });
    }))
      .subscribe(data => {
        this.showLoader = false;
        this.apiContentList = data;
        if (!this.apiContentList.length) {
          return; // no page section
        }
        if (this.apiContentList.length >= 2) {
          this.pageSections = [this.apiContentList[0], this.apiContentList[1]];
        } else if (this.apiContentList.length >= 1) {
          this.pageSections = [this.apiContentList[0]];
        }
      }, err => {
        this.showLoader = false;
        this.apiContentList = [];
        this.pageSections = [];
        this.toasterService.error(this.resourceService.messages.fmsg.m0004);
      });
  }
  public prepareVisits(event) {
    _.forEach(event, (inView, index) => {
      if (inView.metaData.identifier) {
        this.inViewLogs.push({
          objid: inView.metaData.identifier,
          objtype: inView.metaData.contentType,
          index: index,
          section: inView.section,
        });
      }
    });
    this.telemetryImpression.edata.visits = this.inViewLogs;
    this.telemetryImpression.edata.subtype = 'pageexit';
    this.telemetryImpression = Object.assign({}, this.telemetryImpression);
  }
  public playContent(event) {
    this.publicPlayerService.playContent(event);
  }
  ngAfterViewInit() {
    setTimeout(() => {
      this.setTelemetryData();
    });
  }
  ngOnDestroy() {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }
  private setTelemetryData() {
    this.telemetryImpression = {
      context: {
        env: this.activatedRoute.snapshot.data.telemetry.env
      },
      edata: {
        type: this.activatedRoute.snapshot.data.telemetry.type,
        pageid: this.activatedRoute.snapshot.data.telemetry.pageid,
        uri: this.router.url,
        subtype: this.activatedRoute.snapshot.data.telemetry.subtype,
        duration: this.navigationhelperService.getPageLoadTime()
      }
    };
    this.sortIntractEdata = {
      id: 'sort',
      type: 'click',
      pageid: this.activatedRoute.snapshot.data.telemetry.pageid
    };
  }
  private setNoResultMessage() {
    this.noResultMessage = {
      'title': this.resourceService.frmelmnts.lbl.noBookfoundTitle,
      'subTitle': this.resourceService.frmelmnts.lbl.noBookfoundSubTitle,
      'buttonText': this.resourceService.frmelmnts.lbl.noBookfoundButtonText,
      'showExploreContentButton': true
    };
  }

  navigateToExploreContent() {
    this.router.navigate(['explore', 1], { queryParams: this.selectedFilters });
  }

}
