import { SectionFilmsView, FilmsListView, FilmsListContainerView, MoreButtonView, EmptyFilmsView, SortView, LoadingView, UserRaitingView, FilmStatistics } from 'View';
import { FilmPresenter } from 'Presenter';
import { render, remove, RenderPosition } from 'Framework/render';
import { compareFilmsDate, compareFilmsRaiting, filter, getUserRaiting } from 'Sourse/utils';
import { SortType, UpdateType, UserAction, FilterType } from 'Sourse/const';
import UiBlocker from 'Framework/ui-blocker/ui-blocker';

const FILMS_COUNT_STEP = 5;
const TimeLimit = {
  LOWER_LIMIT: 350,
  UPPER_LIMIT: 1000,
};

export default class SectionFilmsPresenter {
  #sectionFilmsComponent = new SectionFilmsView();
  #filmsListComponent = new FilmsListView();
  #filmsListContainerComponent = new FilmsListContainerView();
  #loadingComponent = new LoadingView();
  #emptyFilmsComponent = null;
  #sortComponent = null;
  #moreButtonComponent = null;
  #userRaitingComponent = null;
  #filmsStatisticsComponent = null;
  #activeModal = null;
  #scrollTop = null;
  #htmlScrollTop = null;
  #container = null;
  #headerContainer = null;
  #footerContainer = null;
  #filmModel = null;
  #commentsModel = null;
  #filterModel = null;
  #watchedFilmsLength = null;
  #renderFilmsCount = FILMS_COUNT_STEP;
  #filmPresenter = new Map();
  #currentSortType = SortType.DEFAULT;
  #filterType = FilterType.ALL;
  #isLoading = true;
  #uiBlocker = new UiBlocker(TimeLimit.LOWER_LIMIT, TimeLimit.UPPER_LIMIT);

  #sortMap = {
    [SortType.DEFAULT]: (filteredFilms) => filteredFilms,
    [SortType.DATE]: (filteredFilms) => filteredFilms.sort(compareFilmsDate),
    [SortType.RAITING]: (filteredFilms) => filteredFilms.sort(compareFilmsRaiting),
  };

  constructor(container, headerContainer, footerContainer, filmModel, commentsModel, filterModel) {
    this.#container = container;
    this.#filmModel = filmModel;
    this.#commentsModel = commentsModel;
    this.#filterModel = filterModel;
    this.#headerContainer = headerContainer;
    this.#footerContainer = footerContainer;

    this.#filmModel.addObserver(this.#handleModelEvent);
    this.#filterModel.addObserver(this.#handleModelEvent);
    this.#commentsModel.addObserver(this.#handleModelEvent);
  }

  get films() {
    this.#filterType = this.#filterModel.filter;

    const films = [...this.#filmModel.films];
    const filteredFilms = filter[this.#filterType](films);

    return this.#sortMap[this.#currentSortType](filteredFilms);
  }

  init = () => {
    this.#renderFilmListContainer();
  };

  #handleViewAction = async (actionType, updateType, update, comment) => {
    this.#uiBlocker.block();

    switch (actionType) {
      case UserAction.UPDATE_FILM:
        try {
          await this.#filmModel.updateFilm(updateType, update);
        } catch (error) {
          this.#filmPresenter.get(update.id).setAbording(UserAction.UPDATE_FILM);
        }
        break;
      case UserAction.ADD_COMMENT:
        this.#filmPresenter.get(update.id).setAdded();
        try {
          await this.#commentsModel.addComment(updateType, update.id, comment);
        } catch (error) {
          this.#filmPresenter.get(update.id).setAbording(UserAction.ADD_COMMENT);
        }
        break;
      case UserAction.DELETE_COMMENT:
        this.#filmPresenter.get(update.id).setDeleting(comment);
        try {
          await this.#commentsModel.deleteComment(updateType, update.id, comment);
        } catch (error) {
          this.#filmPresenter.get(update.id).setAbording(UserAction.DELETE_COMMENT, comment);
        }
        break;
    }

    this.#uiBlocker.unblock();
  };

  #handleModelEvent = (updateType, data) => {
    switch (updateType) {
      case UpdateType.PATCH:
        this.#filmPresenter.get(data.id).init(data, this.#commentsModel, this.#activeModal === data.id);
        break;
      case UpdateType.MINOR:
        this.#clearFilmListContainer();
        this.#renderFilmListContainer();
        break;
      case UpdateType.MAJOR:
        this.#clearFilmListContainer({resetRenderFilmsCount: true, resetSortType: true});
        this.#renderFilmListContainer();
        break;
      case UpdateType.INIT:
        this.#isLoading = false;
        remove(this.#loadingComponent);
        this.#renderFilmListContainer();
        break;
    }
  };

  #clearFilmListContainer = ({resetRenderFilmsCount = false, resetSortType = false} = {}) => {
    const filmCount = this.films.length;

    this.#filmPresenter.forEach((presenter) => presenter.destroy());
    this.#filmPresenter.clear();

    remove(this.#sortComponent);
    remove(this.#emptyFilmsComponent);
    remove(this.#moreButtonComponent);
    remove(this.#userRaitingComponent);
    remove(this.#filmsStatisticsComponent);

    this.#renderFilmsCount = resetRenderFilmsCount ? FILMS_COUNT_STEP : Math.min(filmCount, this.#renderFilmsCount);

    if (resetSortType) {
      this.#currentSortType = SortType.DEFAULT;
    }
  };

  #renderFilmListContainer = () => {
    render(this.#sectionFilmsComponent, this.#container);
    render(this.#filmsListComponent, this.#sectionFilmsComponent.element);

    if (this.#isLoading) {
      this.#renderLoading();
      return;
    }

    const films = this.films;
    const filmCount = films.length;

    this.#watchedFilmsLength = films.filter(({userDetails}) => userDetails.watchlist).length;

    if (!this.#watchedFilmsLength < 1) {
      this.#renderUserRaiting(this.#watchedFilmsLength);
    }

    this.#renderStatistics();

    if (this.films.length === 0) {
      this.#renderEmptyFilm();
      return;
    }

    this.#renderSort();
    render(this.#filmsListContainerComponent, this.#filmsListComponent.element);

    this.#renderFilms(films.slice(0, Math.min(filmCount, this.#renderFilmsCount)));

    if (filmCount > this.#renderFilmsCount) {
      this.#renderMoreButton();
    }
  };

  #renderFilm = (film, comments) => {
    const filmPresenter = new FilmPresenter(
      this.#filmsListContainerComponent.element,
      this.#handleViewAction,
      this.#changeStatusModalHandler,
      this.#saveModalScroll,
      this.#inActiveModal,
      this.#saveHtmlScroll,
    );

    filmPresenter.init(film, comments, this.#activeModal === film.id, this.#scrollTop, this.#htmlScrollTop);
    this.#filmPresenter.set(film.id, filmPresenter);
  };

  #renderLoading = () => {
    render(this.#loadingComponent, this.#filmsListComponent.element);
  };

  #renderFilms = (films) => {
    films.forEach((film) => {
      this.#renderFilm(film, this.#commentsModel);
    });
  };

  #renderEmptyFilm = () => {
    this.#emptyFilmsComponent = new EmptyFilmsView(this.#filterType);
    render(this.#emptyFilmsComponent, this.#filmsListComponent.element);
  };

  #renderMoreButton = () => {
    this.#moreButtonComponent = new MoreButtonView();
    render(this.#moreButtonComponent, this.#filmsListComponent.element);

    this.#moreButtonComponent.setMoreButtonClickHandler(this.#clickShowMoreButtonHandler);
  };

  #changeStatusModalHandler = (id) => {
    this.#filmPresenter.forEach((presenter) => presenter.resetView());
    this.#activeModal = id;
  };

  #renderSort = () => {
    this.#sortComponent = new SortView(this.#currentSortType);
    render(this.#sortComponent, this.#sectionFilmsComponent.element, RenderPosition.BEFOREBEGIN);
    this.#sortComponent.setSortTypeChangeHandler(this.#sortTypeChangeHandler);
  };

  #renderUserRaiting = (watchedFilmsLength) => {
    this.#userRaitingComponent = new UserRaitingView(getUserRaiting(watchedFilmsLength));

    render(this.#userRaitingComponent, this.#headerContainer);
  };

  #renderStatistics = () => {
    this.#filmsStatisticsComponent = new FilmStatistics(this.films);
    render(this.#filmsStatisticsComponent, this.#footerContainer);
  };

  #saveModalScroll = (scrollTop) => {
    this.#scrollTop = scrollTop;
  };

  #saveHtmlScroll = (scrollTop) => {
    this.#htmlScrollTop = scrollTop;
  };

  #inActiveModal = () => {
    this.#activeModal = null;
  };

  #clickShowMoreButtonHandler = () => {
    const filmsCount = this.films.length;
    const newRenderFilmsCount = Math.min(filmsCount, this.#renderFilmsCount + FILMS_COUNT_STEP);
    const films = this.films.slice(this.#renderFilmsCount, newRenderFilmsCount);

    this.#renderFilms(films);
    this.#renderFilmsCount = newRenderFilmsCount;

    if (this.#renderFilmsCount >= filmsCount) {
      remove(this.#moreButtonComponent);
    }
  };

  #sortTypeChangeHandler = (sortType) => {
    if (this.#currentSortType === sortType) {
      return;
    }

    this.#currentSortType = sortType;

    this.#clearFilmListContainer({resetRenderFilmsCount: true});
    this.#renderFilmListContainer();
  };
}
