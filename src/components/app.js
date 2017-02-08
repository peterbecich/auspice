import React from "react";
import { connect } from "react-redux";
import { BROWSER_DIMENSIONS, loadJSONs } from "../actions";
import { CHANGE_LAYOUT, CHANGE_DISTANCE_MEASURE, CHANGE_DATE_MIN,
  CHANGE_DATE_MAX, CHANGE_ABSOLUTE_DATE_MIN, CHANGE_ABSOLUTE_DATE_MAX,
  changeColorBy, updateColorScale } from "../actions/controls";

import "whatwg-fetch"; // setup polyfill
import Radium from "radium";
import _ from "lodash";
import Flex from "./framework/flex";
import Header from "./framework/header";
import Footer from "./framework/footer";
import Background from "./framework/background";
import ToggleSidebarTab from "./framework/toggle-sidebar-tab";
import Controls from "./controls/controls";
import Frequencies from "./charts/frequencies";
import Entropy from "./charts/entropy";
import Map from "./map/map";
import TreeView from "./tree/treeView";
import parseParams from "../util/parseParams";
import queryString from "query-string";
import getColorScale from "../util/getColorScale";
import { parseGenotype, getGenotype } from "../util/getGenotype";
import * as globals from "../util/globals";
import { defaultDateRange, defaultLayout, defaultDistanceMeasure,
  tipRadius, freqScale, defaultColorBy } from "../util/globals";
import Sidebar from "react-sidebar";
import moment from 'moment';

const returnStateNeeded = (reduxState) => {
  return {
    tree: reduxState.tree,
    sequences: reduxState.sequences,
    metadata: reduxState.metadata,
    colorOptions: reduxState.metadata.colorOptions,
    colorBy: reduxState.controls.colorBy
  };
};
/* BRIEF (INCOMPLETE) REMINDER OF PROPS AVAILABLE TO APP:
  colorOptions: parameters for each colorBy value (country, region etc)
      ideally come from the JSON, but there are defaults if necessary

  React-Router v4 injects length, action, location, push etc into props,
    but perhaps it's more consistent if we access these through
    this.context.router
    see https://reacttraining.com/react-router/#history
*/
@connect(returnStateNeeded)
@Radium
class App extends React.Component {
  constructor(props) {
    super(props);
    /* window listener to see when width changes cross thrhershold to toggle sidebar */
    /* A note on sidebar terminology:
    sidebarOpen (AFAIK) is only used via touch drag events
    sidebarDocked is the prop used on desktop.
    While these states could be moved to redux, they would need
    to be connected to here, triggering an app render anyways
    */
    const mql = window.matchMedia(`(min-width: ${globals.controlsHiddenWidth}px)`);
    mql.addListener(() => this.setState({sidebarDocked: this.state.mql.matches}));
    this.state = {
      location: {
        pathname: this.props.location.pathname,
        query: queryString.parse(this.props.location.search)
      },
      mql,
      sidebarDocked: mql.matches,
      sidebarOpen: false
    };
  }
  static propTypes = {
    /* react */
    dispatch: React.PropTypes.func.isRequired,
    params: React.PropTypes.object,
    /* component api */
    error: React.PropTypes.object,
    loading: React.PropTypes.bool,
    user: React.PropTypes.object,
    routes: React.PropTypes.array
    // foo: React.PropTypes.string
  }
  static defaultProps = {
    // foo: "bar"

  }
  static contextTypes = {
    router: React.PropTypes.object.isRequired
  }

  componentWillMount() {

    this.initializeReduxStore();
    const tmpQuery = queryString.parse(this.context.router.location.search);
    const pathname = this.props.location.pathname;
    const suffix = (pathname.length && pathname[pathname.length - 1] !== "/") ? "/" : "";
    this.setState({
      location: {
        pathname: pathname + suffix,
        query: tmpQuery
      }
    });
  }

  componentDidMount() {
    // when the user hits the back button or forward, let us know so we can setstate again
    // all of the other intentional route changes we will manually setState

    this.maybeFetchDataset();
    const tmpQuery = queryString.parse(this.context.router.location.search);
    window.addEventListener("popstate", (a, b, c) => {
      this.setState({
        location: {
          pathname: this.props.location.pathname.slice(1, -1),
          query: tmpQuery
        }
      });
    });

    /* initial dimensions */
    this.handleResize()
    /* future resizes */
    window.addEventListener(
      'resize',
      _.throttle(this.handleResize.bind(this), 500, { /* fire every N milliseconds. Could also be _.debounce for 'wait until resize stops' */
        leading: true,
        trailing: true
      }) /* invoke resize event at most twice per second to let redraws catch up */
    );

    // console.log("app.js CDM")
    this.props.dispatch(loadJSONs(this.props.location))
  }

  componentDidUpdate() {
    // console.log("app.js CDU")
    this.maybeFetchDataset();
  }

  initializeReduxStore() {
    const query = queryString.parse(this.context.router.location.search);
    // initialize to query param if available, otherwise use defaults
    if (query.l) {
      this.props.dispatch({ type: CHANGE_LAYOUT, data: query.l });
    } else {
      this.props.dispatch({ type: CHANGE_LAYOUT, data: defaultLayout });
    }

    if (query.m) {
      this.props.dispatch({ type: CHANGE_DISTANCE_MEASURE,
                            data: query.m });
    } else {
      this.props.dispatch({ type: CHANGE_DISTANCE_MEASURE,
                            data: defaultDistanceMeasure });
    }

    // update absolute date range
    const absoluteMin = moment().subtract(defaultDateRange, "years").format("YYYY-MM-DD");
    const absoluteMax = moment().format("YYYY-MM-DD");
    this.props.dispatch({ type: CHANGE_ABSOLUTE_DATE_MIN, data: absoluteMin });
    this.props.dispatch({ type: CHANGE_ABSOLUTE_DATE_MAX, data: absoluteMax });

    // set selected date range to query params if they exist, if not set to defaults
    if (query.dmin) {
      this.props.dispatch({ type: CHANGE_DATE_MIN, data: query.dmin });
    } else {
      this.props.dispatch({ type: CHANGE_DATE_MIN, data: absoluteMin });
    }

    if (query.dmax) {
      this.props.dispatch({ type: CHANGE_DATE_MAX, data: query.dmax });
    } else {
      this.props.dispatch({ type: CHANGE_DATE_MAX, data: absoluteMax });
    }

    if (query.c) {
      this.props.dispatch(changeColorBy(query.c, this.context.router));
    } else {
      this.props.dispatch(changeColorBy(defaultColorBy));
    }

  }

  handleResize() {
    this.props.dispatch({
      type: BROWSER_DIMENSIONS,
      data: {
        width: window.innerWidth,
        height: window.innerHeight,
        docHeight: window.document.body.clientHeight
        /* background needs docHeight because sidebar creates
        absolutely positioned container and blocks height 100% */
      }
    });
  }

  maybeFetchDataset() {
    // console.log("maybeFetchDataset")
    if (this.state.latestValidParams === this.state.location.pathname) {
      return;
    }

    const parsedParams = parseParams(this.state.location.pathname);
    const tmp_levels = Object.keys(parsedParams.dataset).map((d) => parsedParams.dataset[d]);
    tmp_levels.sort((x, y) => x[0] > y[0]);
    // make prefix for data files with fields joined by _ instead of / as in URL
    const data_path = tmp_levels.map((d) => d[1]).join("_");
    if (parsedParams.incomplete) {
      this.setVirusPath(parsedParams.fullsplat);
    }
    if (parsedParams.valid && this.state.latestValidParams !== parsedParams.fullsplat) {
      this.props.dispatch(loadJSONs(data_path))
      this.setState({latestValidParams: parsedParams.fullsplat});
    }
  }

  /******************************************
   * HANDLE QUERY PARAM CHANGES AND ASSOCIATED STATE UPDATES
   *****************************************/
  setVirusPath(newPath) {
    const prefix = (newPath === "" || newPath[0] === "/") ? "" : "/";
    const suffix = (newPath.length && newPath[newPath.length - 1] !== "/") ? "/?" : "?";
    const url = prefix + newPath + suffix + this.context.router.location.search;
    window.history.pushState({}, "", url);
    this.changeRoute(newPath, queryString.parse(this.context.router.location.search));
  }

  changeRoute(pathname, query) {
    pathname = pathname.replace("!/", ""); // needed to assist with S3 redirects
    const prefix = (pathname === "" || pathname[0] === "/") ? "" : "/";
    const suffix = (pathname.length && pathname[pathname.length - 1] !== "/") ? "/?" : "?";
    const url = prefix + pathname + suffix + queryString.stringify(query);
    window.history.pushState({}, "", url);
    this.setState(Object.assign({location:{query, pathname}}));
  }

  currentFrequencies() {
    let freq = "";
    if (this.props.colorBy && this.props.colorBy.slice(0,3) === "gt-") {
      const gt = this.props.colorBy.slice(3).split("_");
      freq = "global_" + gt[0] + ":" + gt[1];
    }
    return freq;
  }

  render() {
    return (
      <Sidebar
        sidebar={
          <Controls
            changeRoute={this.changeRoute.bind(this)}
            location={this.state.location}
            router={this.context.router}
            colorOptions={this.props.colorOptions}
          />
        }
        open={this.state.sidebarOpen}
        docked={this.state.sidebarDocked}
        onSetOpen={(a) => {this.setState({sidebarOpen: a});}}>
        <Background>
          <ToggleSidebarTab
            open={this.state.sidebarDocked}
            handler={() => {this.setState({sidebarDocked: !this.state.sidebarDocked});}}
          />
          <Header/>
          <TreeView
            query={queryString.parse(this.context.router.location.search)}
            sidebar={this.state.sidebarOpen || this.state.sidebarDocked}
          />
          <Map
            sidebar={this.state.sidebarOpen || this.state.sidebarDocked}
            nodes={this.props.tree.nodes}
            justGotNewDatasetRenderNewMap={false}
            />
          <Frequencies
            genotype={this.currentFrequencies()}
          />
          <Entropy
            sidebar={this.state.sidebarOpen || this.state.sidebarDocked}
            changeRoute={this.changeRoute.bind(this)}
            location={this.state.location}
            router={this.context.router}
          />
        </Background>
      </Sidebar>
    );
  }
}

export default App;
